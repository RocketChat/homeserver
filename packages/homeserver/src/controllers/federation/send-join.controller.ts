import { isRoomMemberEvent } from '@hs/core';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	ConfigService,
	ErrorResponse,
	ErrorResponseDto,
	SendJoinResponse,
	SendJoinResponseDto,
	StateService,
} from '@hs/federation-sdk';
import { EventService } from '@hs/federation-sdk';
import { EventEmitterService } from '@hs/federation-sdk';
import { PersistentEventFactory } from '@hs/room';
import { getAuthChain } from '@hs/room';

export const sendJoinPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	const configService = container.resolve(ConfigService);
	const stateService = container.resolve(StateService);

	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:eventId',
		async ({ params, body }) => {
			const { roomId, eventId } = params;

			const roomVersion = await stateService.getRoomVersion(roomId);

			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			console.log(eventId, body);

			const bodyAny = body as any;

			// delete existing auth events and refill them
			bodyAny.auth_events = [];

			const joinEvent = PersistentEventFactory.createFromRawEvent(
				bodyAny,
				roomVersion,
			);

			for await (const authEvent of stateService.getAuthEvents(joinEvent)) {
				joinEvent.authedBy(authEvent);
			}

			// now check the calculated id if it matches what is passed in param
			if (joinEvent.eventId !== eventId) {
				// this is important sanity check
				// while prev_events don't matter as much as it CAN change if we try to recalculate, auth events can not
				throw new Error('join event id did not match what was passed in param');
			}

			// fetch state before allowing join here - TODO: don't just persist the membership like this
			const state = await stateService.getFullRoomState(roomId);

			await stateService.persistStateEvent(joinEvent);

			if (joinEvent.rejected) {
				throw new Error(joinEvent.rejectedReason);
			}

			const origin = configService.getServerConfig().name;

			const authChain = [];

			for (const event of state.values()) {
				const authEvents = await getAuthChain(
					event,
					stateService._getStore(roomVersion),
				);
				authChain.push(...authEvents);
			}

			const authChainEvents = await eventService.getEventsByIds(authChain);

			const signedJoinEvent = await stateService.signEvent(joinEvent);

			return {
				origin,
				event: {
					...signedJoinEvent.event,
					unsigned: {},
				}, // TODO: eh
				members_omitted: false, // less requests
				state: Array.from(state.values()).map((event) => {
					return {
						...event.event,
						unsigned: {}, // TODO: why wrapper isn't doing this
					};
				}), // values().map should have worked but editor is complaining
				auth_chain: authChainEvents.map((event) => {
					return {
						...event.event,
						unsigned: {},
					};
				}),
			};
		},
		{
			params: t.Object({
				roomId: t.String(),
				eventId: t.String(),
			}),
			query: t.Object({
				omit_members: t.Optional(t.Boolean()), // will ignore this for now
			}),
			/* body: t.Object({
				origin: t.String(),
				origin_server_ts: t.Number(),
				sender: t.String(),
				state_key: t.String(),
				type: t.Literal('m.room.member'),
				content: t.Object({
					membership: t.Literal('join'),
				}),
			}), */
			body: t.Any(),
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
