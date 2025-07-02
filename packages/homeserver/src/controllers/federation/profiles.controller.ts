import { container } from 'tsyringe';
import type { RouteDefinition } from '../../types/route.types';
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

export const profilesRoutes: RouteDefinition[] = [
	{
		method: 'GET',
		path: '/_matrix/federation/v1/query/profile',
		handler: async (ctx) => {
			console.log('queryProfile', ctx.query);
			const profilesService = container.resolve(ProfilesService);
			return profilesService.queryProfile(ctx.query.user_id);
		},
		validation: {
			query: QueryProfileQueryDto,
		},
		responses: {
			200: QueryProfileResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Query profile',
			description: "Query a user's profile",
		},
	},
	{
		method: 'POST',
		path: '/_matrix/federation/v1/user/keys/query',
		handler: async (ctx) => {
			const profilesService = container.resolve(ProfilesService);
			return profilesService.queryKeys(ctx.body.device_keys);
		},
		validation: {
			body: QueryKeysBodyDto,
		},
		responses: {
			200: QueryKeysResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Query keys',
			description: "Query a user's device keys",
		},
	},
	{
		method: 'GET',
		path: '/_matrix/federation/v1/user/devices/:userId',
		handler: async (ctx) => {
			const profilesService = container.resolve(ProfilesService);
			return profilesService.getDevices(ctx.params.userId);
		},
		validation: {
			params: GetDevicesParamsDto,
		},
		responses: {
			200: GetDevicesResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Get devices',
			description: "Get a user's devices",
		},
	},
	{
		method: 'GET',
		path: '/_matrix/federation/v1/make_join/:roomId/:userId',
		handler: async (ctx): Promise<MakeJoinResponse | ErrorResponse> => {
			const profilesService = container.resolve(ProfilesService);
			const response = await profilesService.makeJoin(
				ctx.params.roomId,
				ctx.params.userId,
				ctx.query.ver,
			);
			return {
				room_version: response.room_version,
				event: {
					...response.event,
					content: {
						...response.event.content,
						membership: 'join',
						join_authorised_via_users_server:
							response.event.content.join_authorised_via_users_server,
					},
					room_id: response.event.room_id,
					sender: response.event.sender,
					state_key: response.event.state_key,
					type: 'm.room.member',
					origin_server_ts: response.event.origin_server_ts,
					origin: response.event.origin,
				},
			};
		},
		validation: {
			params: MakeJoinParamsDto,
			query: MakeJoinQueryDto,
		},
		responses: {
			200: MakeJoinResponseDto,
			400: ErrorResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Make join',
			description: 'Make a join event',
		},
	},
	{
		method: 'POST',
		path: '/_matrix/federation/v1/get_missing_events/:roomId',
		handler: async (ctx) => {
			const profilesService = container.resolve(ProfilesService);
			return profilesService.getMissingEvents(
				ctx.params.roomId,
				ctx.body.earliest_events,
				ctx.body.latest_events,
				ctx.body.limit,
			);
		},
		validation: {
			params: GetMissingEventsParamsDto,
			body: GetMissingEventsBodyDto,
		},
		responses: {
			200: GetMissingEventsResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Get missing events',
			description: 'Get missing events for a room',
		},
	},
	{
		method: 'GET',
		path: '/_matrix/federation/v1/event_auth/:roomId/:eventId',
		handler: async (ctx) => {
			const profilesService = container.resolve(ProfilesService);
			return profilesService.eventAuth(ctx.params.roomId, ctx.params.eventId);
		},
		validation: {
			params: EventAuthParamsDto,
		},
		responses: {
			200: EventAuthResponseDto,
		},
		metadata: {
			tags: ['Federation'],
			summary: 'Event auth',
			description: 'Get event auth for a room',
		},
	},
];
