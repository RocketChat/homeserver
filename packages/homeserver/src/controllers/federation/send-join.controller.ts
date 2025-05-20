import { Body, Controller, Param, Put } from '@nestjs/common';

import { isRoomMemberEvent } from "@hs/core/src/events/m.room.member";
import { ConfigService } from '../../services/config.service';
import { EventService } from '../../services/event.service';
import { ZodValidationPipe } from '../../validation/pipes/zod-validation.pipe';
import { z } from 'zod';
import { ROOM_ID_REGEX, USERNAME_REGEX } from '../../utils/validation-regex';
import type { EventBase } from '@hs/core/src/events/eventBase';

const SendJoinEventSchema = z.object({
    type: z.literal('m.room.member'),
    content: z.object({
        membership: z.literal('join'),
        displayname: z.string().nullable().optional(),
        avatar_url: z.string().nullable().optional(),
        join_authorised_via_users_server: z.string().nullable().optional(),
        is_direct: z.boolean().nullable().optional(),
    }).and(z.record(z.any())),
    sender: z.string().regex(USERNAME_REGEX),
    state_key: z.string().regex(USERNAME_REGEX),
    room_id: z.string().regex(ROOM_ID_REGEX),
    origin_server_ts: z.number().int().positive(),
    depth: z.number().int().nonnegative(),
    prev_events: z.array(z.string().or(z.tuple([z.string(), z.string()]))),
    auth_events: z.array(z.string().or(z.tuple([z.string(), z.string()]))),
    origin: z.string().nullable().optional(),
    hashes: z.record(z.string()).nullable().optional(),
    signatures: z.record(z.record(z.string())).nullable().optional(),
    unsigned: z.record(z.any()).nullable().optional(),
});

type SendJoinEventDto = Omit<EventBase, 'type' | 'content'> & {
    type: 'm.room.member';
    content: {
        membership: 'join';
        displayname?: string;
        avatar_url?: string;
        join_authorised_via_users_server?: string;
        is_direct?: boolean;
    };
};

type SendJoinResponseDto = {
    event: Record<string, any>;
    state: Record<string, any>[];
    auth_chain: Record<string, any>[];
    members_omitted: boolean;
    origin: string;
};


@Controller('/_matrix/federation/v2')
export class SendJoinController {
    constructor(
        private readonly eventService: EventService,
        private readonly configService: ConfigService,
    ) { }

    @Put("/send_join/:roomId/:stateKey")
    async sendJoin(
        @Param('roomId') roomId: string,
        @Param('stateKey') stateKey: string,
        @Body(new ZodValidationPipe(SendJoinEventSchema)) body: SendJoinEventDto
    ): Promise<SendJoinResponseDto> {
        const event = body;

        const records = await this.eventService.findEvents({ "event.room_id": roomId }, { sort: { "event.depth": 1 } });

        const events = records.map((event) => event.event);

        const lastInviteEvent = records.find(
            (record) =>
                isRoomMemberEvent(record.event) &&
                record.event.content.membership === "invite",
        );

        const eventToSave = {
            ...event,
            origin: event.origin || this.configService.getServerConfig().name
        };

        const result: SendJoinResponseDto = {
            event: {
                ...event,
                unsigned: lastInviteEvent ? {
                    replaces_state: lastInviteEvent._id,
                    prev_content: lastInviteEvent.event.content,
                    prev_sender: lastInviteEvent.event.sender,
                } : undefined,
            },
            state: events.map(event => ({ ...event })),
            auth_chain: events
                .filter((event) => event.depth && event.depth <= 4)
                .map(event => ({ ...event })),
            members_omitted: false,
            origin: this.configService.getServerConfig().name,
        };

        if ((await this.eventService.findEvents({ _id: stateKey })).length === 0) {
            await this.eventService.insertEvent(eventToSave, stateKey);
        }

        return result;
    }
}