import { Elysia } from 'elysia';
import { container } from 'tsyringe';
import { z } from 'zod';
import { ProfilesService } from '../../services/profiles.service';

const MakeJoinQueryParamsSchema = z.object({
	ver: z.array(z.string()).optional(),
});

type MakeJoinQueryParamsDto = z.infer<typeof MakeJoinQueryParamsSchema>;
type MakeJoinResponseDto = {
	room_version: string;
	event: {
		content: {
			membership: 'join';
			join_authorised_via_users_server?: string;
			[key: string]: any;
		};
		room_id: string;
		sender: string;
		state_key: string;
		type: 'm.room.member';
		origin_server_ts: number;
		origin: string;
		[key: string]: any;
	};
};

export const profilesPlugin = (app: Elysia) => {
	const profilesService = container.resolve(ProfilesService);
	return app
		.get('/_matrix/federation/v1/query/profile', ({ query }) =>
			profilesService.queryProfile(query.user_id as string),
		)
		.post('/_matrix/federation/v1/user/keys/query', async ({ body }) =>
			profilesService.queryKeys(
				(body as { device_keys: Record<string, string> }).device_keys,
			),
		)
		.get('/_matrix/federation/v1/user/devices/:userId', ({ params }) =>
			profilesService.getDevices(params.userId as string),
		)
		.get(
			'/_matrix/federation/v1/make_join/:roomId/:userId',
			async ({ params, query }) => {
				const parsed = MakeJoinQueryParamsSchema.safeParse(query);
				if (!parsed.success) {
					return { error: 'Invalid query params' };
				}
				const response = await profilesService.makeJoin(
					params.roomId as string,
					params.userId as string,
					parsed.data.ver,
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
				} as MakeJoinResponseDto;
			},
		)
		.post(
			'/_matrix/federation/v1/get_missing_events/:roomId',
			async ({ params, body }) =>
				profilesService.getMissingEvents(
					params.roomId as string,
					(body as { earliest_events: string[] }).earliest_events,
					(body as { latest_events: string[] }).latest_events,
					(body as { limit: number }).limit,
				),
		)
		.get('/_matrix/federation/v1/event_auth/:roomId/:eventId', ({ params }) =>
			profilesService.eventAuth(
				params.roomId as string,
				params.eventId as string,
			),
		);
};
