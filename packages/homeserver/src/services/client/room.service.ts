import { Injectable } from "@nestjs/common";
import { EventRepository } from "../../repositories/event.repository";
import { ConfigService } from "../config.service";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import { createRoomCreateEvent } from "@hs/core/src/events/m.room.create";
import { createRoomMemberEvent, roomMemberEvent } from "@hs/core/src/events/m.room.member";
import { createRoomPowerLevelsEvent } from "@hs/core/src/events/m.room.power_levels";
import { createRoomJoinRulesEvent } from "@hs/core/src/events/m.room.join_rules";
import { createRoomHistoryVisibilityEvent } from "@hs/core/src/events/m.room.history_visibility";
import { createRoomGuestAccessEvent } from "@hs/core/src/events/m.room.guest_access";
import { EventBase } from "@hs/core/src/events/eventBase";
import { createMediaId } from "../../utils/createMediaId";
import { signEvent } from "../../signEvent";
import { generateId } from "../../authentication";
import { makeUnsignedRequest } from "../../makeRequest";
import { FederationRequestService } from "@hs/federation-sdk";

@Injectable()
export class ClientRoomService {

    constructor(
        private readonly configService: ConfigService,
        private readonly eventRepository: EventRepository,
        private readonly requestService: FederationRequestService,
    ) { }

    public async create(username: string, sender: string): Promise<{
        roomId: string;
        events: {
            event: EventBase;
            _id: string;
        }[];
    }> {
        const serverName = this.configService.getServerName();
        if (sender.split(":").pop() !== serverName) {
            throw new Error("Invalid sender");
        }

        const signingKey = (await this.configService.getSigningKey())[0];
        const { roomId, events } = await this.createRoomEvents(
            [sender, username],
            createSignedEvent(signingKey, serverName),
            `!${createMediaId(18)}:${serverName}`,
        );

        if (events.length === 0) {
            throw new Error("Error creating room");
        }

        await this.eventRepository.createMany(events.map((event) => event.event));
        return {
            roomId,
            events,
        };
    }


    public async invite({ username, roomId, sender }: { username: string, sender?: string, roomId?: string }) {
        const serverName = this.configService.getServerName();
        const signingKey = (await this.configService.getSigningKey())[0];
        if (!username.includes(":") || !username.includes("@")) {
            throw new Error("Invalid username");
        }
        let roomIdToInvite = roomId;
        // Create room if no roomId to facilitate tests
        if (sender && !roomId) {
            const { roomId } = await this.create(username, sender);
            roomIdToInvite = roomId;
        }
        if (!roomIdToInvite) {
            throw new Error("Invalid room_id");
        }
        const events = await this.eventRepository
            .find({ "event.room_id": roomIdToInvite }, { sort: { "event.depth": 1 } });
        if (events.length === 0) {
            throw new Error("No events found");
        }
        const lastEventIndex = events[events.length - 1];
        const lastEventId = lastEventIndex._id;
        const lastEvent = lastEventIndex.event as any; //TODO: fix typing
        const inviteEvent = await signEvent(
            roomMemberEvent({
                auth_events: {
                    // that's not true but it's a fake operation
                    create: lastEvent.auth_events[0],
                    power_levels: lastEvent.auth_events[1],
                    join_rules: lastEvent.auth_events[2],
                    history_visibility: lastEvent.auth_events[3],
                },
                membership: "invite",
                depth: lastEvent.depth + 1,
                // origin: lastEvent.origin,
                content: {
                    is_direct: true,
                },
                roomId: roomIdToInvite,
                ts: Date.now(),
                prev_events: [lastEventId],
                sender: events[0].event.sender,
                state_key: username,
                unsigned: {
                    age: 4, // TODO: Check what this is
                    invite_room_state: [
                        {
                            // @ts-ignore
                            content: {},
                            sender: events[0].event.sender,
                            state_key: "",
                            type: "m.room.join_rules",
                        },
                        {
                            // @ts-ignore
                            content: {},
                            sender: events[0].event.sender,
                            state_key: "",
                            type: "m.room.create",
                        },
                        {
                            // @ts-ignore
                            content: {},
                            sender: events[0].event.sender,
                            state_key: events[0].event.sender,
                            type: "m.room.member",
                        },
                    ],
                },
            }),
            signingKey,
            serverName,
        );
        const inviteEventId = generateId(inviteEvent);
        const payload = {
            event: inviteEvent,
            invite_room_state: inviteEvent.unsigned.invite_room_state,
            room_version: "10",
        };
        console.log("invite payload ->", payload);
        console.log("invite roomId ->", roomIdToInvite);
        console.log("invite eventId ->", inviteEventId);

        const domain = username.split(":").pop() as string;

        const responseMake = await makeUnsignedRequest({
            method: "PUT",
            domain,
            uri: `/_matrix/federation/v2/invite/${roomIdToInvite}/${inviteEventId}`,
            body: payload,
            options: {},
            signingKey,
            signingName: serverName,
        });


        if (!responseMake || !responseMake.event) {
            console.error("Federation invite failed or returned an unexpected response structure.", responseMake);
            throw new Error("Federation invite failed: No event in response");
        }

        const responseEventId = generateId(responseMake.event);
        console.log("invite response responseEventId ->", responseEventId);
        console.log("invite response ->", responseMake);
        await this.eventRepository.create(responseMake.event);
        return responseMake;
    }

    private async createRoomEvents(
        users: [sender: string, ...username: string[]],
        makeSignedEvent: ReturnType<typeof createSignedEvent>,
        roomId: string,
    ): Promise<{
        roomId: string;
        events: {
            event: EventBase;
            _id: string;
        }[];
    }> {
        const [sender, ...members] = users;

        const createRoomSigned = createRoomCreateEvent(makeSignedEvent);
        const createMemberRoomSigned = createRoomMemberEvent(makeSignedEvent);
        const createPowerLevelsRoomSigned = createRoomPowerLevelsEvent(makeSignedEvent);
        const createJoinRulesRoomSigned = createRoomJoinRulesEvent(makeSignedEvent);
        const createHistoryVisibilityRoomSigned = createRoomHistoryVisibilityEvent(makeSignedEvent);
        const createGuestAccessRoomSigned = createRoomGuestAccessEvent(makeSignedEvent);

        // Explicitly type the events to match the return signature
        const createEvent = await createRoomSigned({
            roomId,
            sender,
        });

        const memberEvent = await createMemberRoomSigned({
            roomId,
            sender,
            depth: 2,
            membership: "join",
            content: {
                displayname: sender,
            },
            state_key: sender,
            auth_events: {
                create: createEvent._id,
            },
            prev_events: [createEvent._id],
        });

        const powerLevelsEvent = await createPowerLevelsRoomSigned({
            roomId,
            members: [sender, ...members],
            auth_events: [createEvent._id, memberEvent._id],
            prev_events: [memberEvent._id],
            depth: 3,
        });

        const joinRulesEvent = await createJoinRulesRoomSigned({
            roomId,
            sender,
            auth_events: [createEvent._id, memberEvent._id, powerLevelsEvent._id],
            prev_events: [powerLevelsEvent._id],
            depth: 4,
        });

        const historyVisibilityEvent = await createHistoryVisibilityRoomSigned({
            roomId,
            sender,
            auth_events: [
                createEvent._id,
                memberEvent._id,
                powerLevelsEvent._id,
            ],
            prev_events: [joinRulesEvent._id],
            depth: 5,
        });

        const guestAccessEvent = await createGuestAccessRoomSigned({
            roomId,
            sender,
            auth_events: [
                createEvent._id,
                memberEvent._id,
                powerLevelsEvent._id,
            ],
            prev_events: [historyVisibilityEvent._id],
            depth: 6,
        });

        const events = [
            createEvent,
            memberEvent,
            powerLevelsEvent,
            joinRulesEvent,
            historyVisibilityEvent,
            guestAccessEvent,
        ];

        return {
            roomId,
            events,
        };
    }
}