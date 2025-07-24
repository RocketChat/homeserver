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
	ProfilesService,
	QueryKeysBodyDto,
	QueryKeysResponseDto,
	QueryProfileQueryDto,
	QueryProfileResponseDto,
} from '@hs/federation-sdk';
import { type RoomVersion } from '@hs/room';

export const profilesPlugin = (app: Elysia) => {
	const profilesService = container.resolve(ProfilesService);

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
			async ({ params, query }) => {
				const { roomId, userId } = params;

				const { ver } = query;

				return profilesService.makeJoin(
					roomId,
					userId,
					(ver as RoomVersion[]) ?? ['1'],
				) as any;
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
			({ params }) => profilesService.eventAuth(params.roomId, params.eventId),
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
