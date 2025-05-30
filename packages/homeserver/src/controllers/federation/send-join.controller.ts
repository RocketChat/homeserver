import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { isRoomMemberEvent } from '@hs/core/src/events/m.room.member';
import { ConfigService } from '../../services/config.service';
import { EventService } from '../../services/event.service';
import { z } from 'zod';
import { ROOM_ID_REGEX, USERNAME_REGEX } from '../../utils/validation-regex';
import type { EventBase } from '@hs/core/src/events/eventBase';

const SendJoinEventSchema = z.object({
	type: z.literal('m.room.member'),
	content: z
		.object({
			membership: z.literal('join'),
			displayname: z.string().nullable().optional(),
			avatar_url: z.string().nullable().optional(),
			join_authorised_via_users_server: z.string().nullable().optional(),
			is_direct: z.boolean().nullable().optional(),
		})
		.and(z.record(z.any())),
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

export const sendJoinPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	const configService = container.resolve(ConfigService);
	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:stateKey',
		async ({ params, body }) => {
			const parseResult = SendJoinEventSchema.safeParse(body);
			if (!parseResult.success) {
				return {
					error: 'Invalid event body',
					details: parseResult.error.flatten(),
				};
			}
			const event = body as SendJoinEventDto;
			const { roomId, stateKey } = params as {
				roomId: string;
				stateKey: string;
			};

			const records = await eventService.findEvents(
				{ 'event.room_id': roomId },
				{ sort: { 'event.depth': 1 } },
			);
			const events = records.map((event) => event.event);
			const lastInviteEvent = records.find(
				(record) =>
					isRoomMemberEvent(record.event) &&
					record.event.content.membership === 'invite',
			);
			const eventToSave = {
				...event,
				origin: event.origin || configService.getServerConfig().name,
			};
			const result = {
				event: {
					...event,
					unsigned: lastInviteEvent
						? {
								replaces_state: lastInviteEvent._id,
								prev_content: lastInviteEvent.event.content,
								prev_sender: lastInviteEvent.event.sender,
							}
						: undefined,
				},
				state: events.map((event) => ({ ...event })),
				auth_chain: events
					.filter((event) => event.depth && event.depth <= 4)
					.map((event) => ({ ...event })),
				members_omitted: false,
				origin: configService.getServerConfig().name,
			};
			if ((await eventService.findEvents({ _id: stateKey })).length === 0) {
				await eventService.insertEvent(eventToSave, stateKey);
			}
			return result as SendJoinResponseDto;
		},
	);
};
