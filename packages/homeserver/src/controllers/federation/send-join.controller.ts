import { Body, Controller, Param, Put } from '@nestjs/common';

import type { EventBase } from "@hs/core/src/events/eventBase";
import { isRoomMemberEvent } from "@hs/core/src/events/m.room.member";
import type { HashedEvent } from "../../authentication";
import { ConfigService } from '../../services/config.service';
import { EventService } from '../../services/event.service';
import type { SignedEvent } from "../../signJson";

@Controller('/_matrix/federation/v1')
export class SendJoinController {
    constructor(
        private readonly eventService: EventService,
        private readonly configService: ConfigService,
    ) {}

    @Put("/send_join/:roomId/:stateKey")
    async sendJoin(@Param('roomId') roomId: string, @Param('stateKey') stateKey: string, @Body() body: unknown) {
        const event = body as SignedEvent<HashedEvent<EventBase>>;

        const records = await this.eventService.findEvents({ "event.room_id": roomId }, { sort: { "event.depth": 1 } });

        const events = records.map((event) => event.event);

        const lastInviteEvent = records.find(
            (record) =>
                isRoomMemberEvent(record.event as unknown as EventBase) &&
                record.event.content.membership === "invite",
        );

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
            auth_chain: events.filter((event) => event.depth && event.depth <= 4),
            members_omitted: false,
            origin: this.configService.getServerConfig().name,
        } as const;

        if (!(await this.eventService.findEvents({ _id: stateKey }))) {
            await this.eventService.insertEvent(event as any);
        }

        return result;
    }
}