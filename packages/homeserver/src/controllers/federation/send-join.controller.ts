import { isRoomMemberEvent } from '@hs/core';
import {
	ErrorResponseDto,
	SendJoinEventDto,
	SendJoinParamsDto,
	SendJoinResponseDto,
} from '@hs/federation-sdk';
import { ConfigService } from '@hs/federation-sdk';
import { EventService } from '@hs/federation-sdk';
import { EventEmitterService } from '@hs/federation-sdk';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';

export const sendJoinPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	const configService = container.resolve(ConfigService);
	const emitter = container.resolve(EventEmitterService);
	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:stateKey',
		async ({ params, body }) => {
			const event = body;
			const { roomId, stateKey } = params;

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
			let eventId = stateKey;
			if ((await eventService.findEvents({ _id: stateKey })).length === 0) {
				eventId = await eventService.insertEvent(eventToSave, stateKey);
			}

			emitter.emit('homeserver.matrix.accept-invite', {
				event_id: eventId,
				room_id: roomId,
				sender: eventToSave.sender,
				origin_server_ts: eventToSave.origin_server_ts,
				content: {
					avatar_url: eventToSave.content.avatar_url || null,
					displayname: eventToSave.content.displayname || '',
					membership: eventToSave.content.membership || 'join',
				},
			});
			return result;
		},
		{
			params: SendJoinParamsDto,
			body: SendJoinEventDto,
			response: {
				200: SendJoinResponseDto,
				400: ErrorResponseDto,
			},
			detail: {
				tags: ['Federation'],
				summary: 'Send join',
				description: 'Send a join event to a room',
			},
		},
	);
};
