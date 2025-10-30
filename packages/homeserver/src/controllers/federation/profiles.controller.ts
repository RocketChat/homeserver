import { EventID, RoomID, UserID } from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import { canAccessResourceMiddleware } from '@rocket.chat/homeserver/middlewares/canAccessResource';
import { isAuthenticatedMiddleware } from '@rocket.chat/homeserver/middlewares/isAuthenticated';
import { Elysia, t } from 'elysia';
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
	return app
		.group('/_matrix', (app) =>
			app
				.use(isAuthenticatedMiddleware())
				.get(
					'/federation/v1/query/profile',
					({ query: { user_id } }) =>
						federationSDK.queryProfile(user_id as UserID),
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
					'/federation/v1/user/keys/query',
					async ({ set }) => {
						set.status = 501;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'E2EE is not implemented yet',
						};
					},
					{
						body: QueryKeysBodyDto,
						response: {
							200: QueryKeysResponseDto,
							501: t.Object({
								errcode: t.String(),
								error: t.String(),
							}),
						},
						detail: {
							tags: ['Federation'],
							summary: 'Query keys',
							description: "Query a user's device keys (E2EE not implemented)",
						},
					},
				)
				.get(
					'/federation/v1/user/devices/:userId',
					async ({ set }) => {
						set.status = 501;
						return {
							errcode: 'M_UNRECOGNIZED',
							error: 'E2EE is not implemented yet',
						};
					},
					{
						params: GetDevicesParamsDto,
						response: {
							200: GetDevicesResponseDto,
							501: t.Object({
								errcode: t.String(),
								error: t.String(),
							}),
						},
						detail: {
							tags: ['Federation'],
							summary: 'Get devices',
							description: "Get a user's devices (E2EE not implemented)",
						},
					},
				),
		)
		.use(canAccessResourceMiddleware('room'))
		.get(
			'/_matrix/federation/v1/make_join/:roomId/:userId',
			async ({ params, query: _query }) => {
				const { roomId, userId } = params;

				// const { ver } = query;

				return federationSDK.makeJoin(roomId as RoomID, userId as UserID, [
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
				federationSDK.getMissingEvents(
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
				federationSDK.eventAuth(
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
