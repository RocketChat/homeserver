import { StateService } from '@hs/federation-sdk';
import { Elysia, t } from 'elysia';
import { container } from 'tsyringe';

export const roomPlugin = (app: Elysia) => {
	const stateService = container.resolve(StateService);

	app.get(
		'/_matrix/federation/v1/publicRooms',
		async ({ query }) => {
			const defaultObj = {
				join_rule: 'public',
				guest_can_join: false, // trying to reduce requried endpoint hits
				world_readable: false, // ^^^
				avatar_url: '', // ?? don't have any yet
			};

			const { limit: _limit } = query;

			const publicRooms = await stateService.getAllPublicRoomIdsAndNames();

			return {
				chunk: publicRooms.map((room) => ({
					...defaultObj,
					...room,
				})),
			};
		},
		{
			query: t.Object({
				include_all_networks: t.Boolean(), // we ignore this
				limit: t.Number(),
			}),
			response: t.Object({
				chunk: t.Array(
					t.Object({
						avatar_url: t.String(),
						canonical_alias: t.Optional(t.String()),
						guest_can_join: t.Boolean(),
						join_rule: t.String(),
						name: t.String(),
						num_joined_members: t.Optional(t.Number()),
						room_id: t.String(),
						room_type: t.Optional(t.String()),
						topic: t.Optional(t.String()),
						world_readable: t.Boolean(),
					}),
				),
			}),
		},
	);

	app.post(
		'/_matrix/federation/v1/publicRooms',
		async ({ body }) => {
			const defaultObj = {
				join_rule: 'public',
				guest_can_join: false, // trying to reduce requried endpoint hits
				world_readable: false, // ^^^
				avatar_url: '', // ?? don't have any yet
			};

			const { filter } = body;

			const publicRooms = await stateService.getAllPublicRoomIdsAndNames();

			return {
				chunk: publicRooms
					.filter((r) => {
						if (filter.generic_search_term) {
							return r.name
								.toLowerCase()
								.includes(filter.generic_search_term.toLowerCase());
						}

						if (filter.room_types) {
							// TODO:
						}
					})
					.map((room) => ({
						...defaultObj,
						...room,
					})),
			};
		},
		{
			// {"filter":{"generic_search_term":"","room_types":[null]},"include_all_networks":"false","limit":50}
			body: t.Object({
				include_all_networks: t.Optional(t.String()), // we ignore this
				limit: t.Optional(t.Number()),
				filter: t.Object({
					generic_search_term: t.Optional(t.String()),
					room_types: t.Optional(t.Array(t.Union([t.String(), t.Null()]))),
				}),
			}),
			response: t.Object({
				chunk: t.Array(
					t.Object({
						avatar_url: t.String(),
						canonical_alias: t.Optional(t.String()),
						guest_can_join: t.Boolean(),
						join_rule: t.String(),
						name: t.String(),
						num_joined_members: t.Optional(t.Number()),
						room_id: t.String(),
						room_type: t.Optional(t.String()),
						topic: t.Optional(t.String()),
						world_readable: t.Boolean(),
					}),
				),
			}),
		},
	);
	return app;
};
