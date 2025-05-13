import { Controller, Injectable, Put } from '@nestjs/common';
import { isConfigContext } from '../plugins/isConfigContext';

import type { EventBase } from "@hs/core/src/events/eventBase";
import { isRoomMemberEvent } from "@hs/core/src/events/m.room.member";
import type { HashedEvent } from "../authentication";
import { isMongodbContext } from "../plugins/isMongodbContext";
import type { SignedEvent } from "../signJson";

@Controller('/_matrix/federation/v1')
@Injectable()
export class SendJoinController {
    constructor() {}

    @Put("/send_join/:roomId/:stateKey")
    async sendJoin({ params, body, ...context }: { params: any, body: any, context: any }) {
        if (!isConfigContext(context)) {
            throw new Error("No config context");
        }
        if (!isMongodbContext(context)) {
            throw new Error("No mongodb context");
        }
        const {
            config,
            mongo: { eventsCollection },
        } = context;

        const roomId = decodeURIComponent(params.roomId);
        const stateKey = decodeURIComponent(params.stateKey);
        const event = body as SignedEvent<HashedEvent<EventBase>>;

        console.log("sendJoin ->", { roomId, stateKey });
        console.log("sendJoin ->", { body });

        const records = await eventsCollection
            .find({ "event.room_id": roomId }, { sort: { "event.depth": 1 } })
            .toArray();

        const events = records.map((event) => event.event);

        const lastInviteEvent = records.find(
            (record) =>
                isRoomMemberEvent(record.event) &&
                record.event.content.membership === "invite",
            // event.state_key === stateKey,
        );

        // console.log("lastEvent ->", lastEvent);

        // const joinEvent = events.pop();
        const result = {
            event: {
                ...event,
                unsigned: lastInviteEvent && {
                    replaces_state: lastInviteEvent._id,
                    prev_content: lastInviteEvent.event.content,
                    prev_sender: lastInviteEvent.event.sender,
                },
            } as SignedEvent<HashedEvent<EventBase>>,
            state: events,
            auth_chain: events.filter((event) => event.depth <= 4),
            // auth_chain: [],
            members_omitted: false,
            origin: config.name,
        } as const;

        console.log("sendJoin result ->", result);

        if (!(await eventsCollection.findOne({ _id: stateKey }))) {
            await eventsCollection.insertOne({
                _id: stateKey,
                event,
            });
        }

        return result;
    }
}