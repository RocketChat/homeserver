import { isRoomMemberEvent } from '@hs/core/src/events/m.room.member';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	type SendJoinResponse,
	ErrorResponseDto,
	SendJoinEventDto,
	SendJoinParamsDto,
	SendJoinResponseDto,
} from '../../dtos';
import { ConfigService } from '../../services/config.service';
import { EventService } from '../../services/event.service';
import { StateService } from '../../services/state.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import { getAuthChain } from '@hs/room/src/state_resolution/definitions/definitions';

export const sendJoinPlugin = (app: Elysia) => {
	const eventService = container.resolve(EventService);
	const configService = container.resolve(ConfigService);
	const stateService = container.resolve(StateService);

	return app.put(
		'/_matrix/federation/v2/send_join/:roomId/:eventId',
		async ({
			params,
			body,
			query,
		}): Promise<SendJoinResponse | ErrorResponse> => {
			// const event = body;
			// const { roomId, stateKey } = params;

			// const records = await eventService.findEvents(
			// 	{ 'event.room_id': roomId },
			// 	{ sort: { 'event.depth': 1 } },
			// );
			// const events = records.map((event) => event.event);
			// const lastInviteEvent = records.find(
			// 	(record) =>
			// 		isRoomMemberEvent(record.event) &&
			// 		record.event.content.membership === 'invite',
			// );
			// const eventToSave = {
			// 	...event,
			// 	origin: event.origin || configService.getServerConfig().name,
			// };
			// const result = {
			// 	event: {
			// 		...event,
			// 		unsigned: lastInviteEvent
			// 			? {
			// 					replaces_state: lastInviteEvent._id,
			// 					prev_content: lastInviteEvent.event.content,
			// 					prev_sender: lastInviteEvent.event.sender,
			// 				}
			// 			: undefined,
			// 	},
			// 	state: events.map((event) => ({ ...event })),
			// 	auth_chain: events
			// 		.filter((event) => event.depth && event.depth <= 4)
			// 		.map((event) => ({ ...event })),
			// 	members_omitted: false,
			// 	origin: configService.getServerConfig().name,
			// };
			// if ((await eventService.findEvents({ _id: stateKey })).length === 0) {
			// 	await eventService.insertEvent(eventToSave, stateKey);
			// }
			// return result;

			const { roomId, eventId: _eventId } = params;

			const roomVersion = await stateService.getRoomVersion(roomId);

			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			const roomInformation = await stateService.getRoomInformation(roomId);

			const joinEvent = PersistentEventFactory.newMembershipEvent(
				roomId,
				body.sender,
				body.state_key,
				body.content.membership,
				roomInformation,
			);

			for await (const prevEvent of stateService.getPrevEvents(joinEvent)) {
				joinEvent.addPreviousEvent(prevEvent);
			}

			for await (const authEvent of stateService.getAuthEvents(joinEvent)) {
				joinEvent.authedBy(authEvent);
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
					...signedJoinEvent,
					unsigned: {},
					origin: origin,
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
			body: t.Object({
				origin: t.String(),
				origin_server_ts: t.Number(),
				sender: t.String(),
				state_key: t.String(),
				type: t.Literal('m.room.member'),
				content: t.Object({
					membership: t.Literal('join'),
				}),
			}),
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
