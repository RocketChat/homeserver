import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
	type ErrorResponse,
	type MakeJoinResponse,
	ErrorResponseDto,
	EventAuthParamsDto,
	EventAuthResponseDto,
	GetDevicesParamsDto,
	GetDevicesResponseDto,
	GetMissingEventsBodyDto,
	GetMissingEventsParamsDto,
	GetMissingEventsResponseDto,
	MakeJoinParamsDto,
	MakeJoinQueryDto,
	MakeJoinResponseDto,
	QueryKeysBodyDto,
	QueryKeysResponseDto,
	QueryProfileQueryDto,
	QueryProfileResponseDto,
} from '../../dtos';
import { ProfilesService } from '../../services/profiles.service';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import { StateService } from '../../services/state.service';
import { EventService } from '../../services/event.service';
import { getAuthChain } from '@hs/room/src/state_resolution/definitions/definitions';

export const profilesPlugin = (app: Elysia) => {
	const profilesService = container.resolve(ProfilesService);

	const stateService = container.resolve(StateService);

	return app
		.get(
			'/_matrix/federation/v1/query/profile',
			({ query: { user_id } }) => profilesService.queryProfile(user_id),
			{
				query: QueryProfileQueryDto,
				response: {
					200: QueryProfileResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Query profile',
					description: "Query a user's profile",
				},
			},
		)
		.post(
			'/_matrix/federation/v1/user/keys/query',
			async ({ body }) => profilesService.queryKeys(body.device_keys),
			{
				body: QueryKeysBodyDto,
				response: {
					200: QueryKeysResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Query keys',
					description: "Query a user's device keys",
				},
			},
		)
		.get(
			'/_matrix/federation/v1/user/devices/:userId',
			({ params }) => profilesService.getDevices(params.userId),
			{
				params: GetDevicesParamsDto,
				response: {
					200: GetDevicesResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Get devices',
					description: "Get a user's devices",
				},
			},
		)
		.get(
			'/_matrix/federation/v1/make_join/:roomId/:userId',
			async ({ params, query }): Promise<MakeJoinResponse | ErrorResponse> => {
				// const response = await profilesService.makeJoin(
				// 	params.roomId,
				// 	params.userId,
				// 	query.ver,
				// );
				// return {
				// 	room_version: response.room_version,
				// 	event: {
				// 		...response.event,
				// 		content: {
				// 			...response.event.content,
				// 			membership: 'join',
				// 			join_authorised_via_users_server:
				// 				response.event.content.join_authorised_via_users_server,
				// 		},
				// 		room_id: response.event.room_id,
				// 		sender: response.event.sender,
				// 		state_key: response.event.state_key,
				// 		type: 'm.room.member',
				// 		origin_server_ts: response.event.origin_server_ts,
				// 		origin: response.event.origin,
				// 	},
				// };

				const { roomId, userId } = params;

				const roomInformation = await stateService.getRoomInformation(roomId);

				const membershipEvent = PersistentEventFactory.newMembershipEvent(
					roomId,
					userId,
					userId,
					'join',
					roomInformation,
				);

				await stateService.fillAuthEvents(membershipEvent);

				// @ts-ignore prop exist8ing changes beghavior
				// biome-ignore lint/performance/noDelete: <explanation>
				delete membershipEvent.event.content.join_authorised_via_users_server;

				// ignore ver, only 11
				return {
					room_version: roomInformation.room_version,
					event: membershipEvent.event as any,
				};
			},
			{
				params: MakeJoinParamsDto,
				query: MakeJoinQueryDto,
				response: {
					200: MakeJoinResponseDto,
					400: ErrorResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Make join',
					description: 'Make a join event',
				},
			},
		)
		.post(
			'/_matrix/federation/v1/get_missing_events/:roomId',
			async ({ params, body }) =>
				profilesService.getMissingEvents(
					params.roomId,
					body.earliest_events,
					body.latest_events,
					body.limit,
				),
			{
				params: GetMissingEventsParamsDto,
				body: GetMissingEventsBodyDto,
				response: {
					200: GetMissingEventsResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Get missing events',
					description: 'Get missing events for a room',
				},
			},
		)
		.get(
			'/_matrix/federation/v1/event_auth/:roomId/:eventId',
			async ({ params }) => {
				const { roomId, eventId } = params;

				console.log('eventId to find authchain for', eventId);

				const roomVersion = await stateService.getRoomVersion(roomId);

				if (!roomVersion) {
					throw new Error(
						'Room version not found while trying to get auth chain',
					);
				}

				const store = stateService._getStore(roomVersion);

				const [event] = await store.getEvents([eventId]);
				if (!event) {
					throw new Error('Event not found while trying to get auth chain');
				}

				const authChainIds = await getAuthChain(event, store);

				const authChain = await store.getEvents(Array.from(authChainIds));

				const pdus = authChain.map((e) => e.event);

				console.log('authChain', pdus);

				return { auth_chain: pdus };
			},
			{
				params: EventAuthParamsDto,
				response: {
					200: EventAuthResponseDto,
				},
				detail: {
					tags: ['Federation'],
					summary: 'Event auth',
					description: 'Get event auth for a room',
				},
			},
		);
};
