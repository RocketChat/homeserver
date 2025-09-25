import {
	EventID,
	RoomID,
	UserID,
} from '@rocket.chat/federation-room';
import {
	EventAuthorizationService,
	ProfilesService,
} from '@rocket.chat/federation-sdk';
import {
	canAccessResource,
	isAuthenticated,
} from '@rocket.chat/homeserver/middlewares';
import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import {
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

export const profilesPlugin = (app: Elysia) => {
	const profilesService = container.resolve(ProfilesService);
	const eventAuthService = container.resolve(EventAuthorizationService);

	return app
		.use(isAuthenticated(eventAuthService))
		.use(canAccessResource(eventAuthService))
		.get(
			'/_matrix/federation/v1/query/profile',
			({ query: { user_id } }) =>
				profilesService.queryProfile(user_id as UserID),
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
			({ params }) => profilesService.getDevices(params.userId as UserID),
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
			async ({ params, query: _query }) => {
				const { roomId, userId } = params;

				// const { ver } = query;

				return profilesService.makeJoin(roomId as RoomID, userId as UserID, [
					'10',
				]);
			},
			{
				params: MakeJoinParamsDto,
				query: t.Any(),
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
					params.roomId as RoomID,
					body.earliest_events as EventID[],
					body.latest_events as EventID[],
					body.limit,
					body.min_depth,
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
			({ params }) =>
				profilesService.eventAuth(
					params.roomId as RoomID,
					params.eventId as EventID,
				),
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
