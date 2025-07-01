import { Elysia, t } from 'elysia';
import { StateService } from '../../services/state.service';
import { container } from 'tsyringe';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import type { Transaction } from '@hs/federation-sdk/src/specs/federation-api';
import { ConfigService } from '../../services/config.service';
import { FederationService } from '@hs/federation-sdk/src/services/federation.service';

export const roomPlugin = (app: Elysia) => {
	const stateService = container.resolve(StateService);
	const configService = container.resolve(ConfigService);
	const federationService = container.resolve(FederationService);
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

						return true;
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
				include_all_networks: t.Optional(t.Boolean()), // we ignore this
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

	app.post(
		'/internal/:roomId/message',
		async ({ params, body }) => {
			const { roomId } = params;
			const { text, sender } = body;

			const roomVersion = await stateService.getRoomVersion(roomId);
			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			const message = PersistentEventFactory.newMessageEvent(
				roomId,
				sender,
				text,
				roomVersion,
			);

			const state = await stateService.getFullRoomState(roomId);

			const requiredAuthEvents = message.getAuthEventStateKeys();

			for (const key of requiredAuthEvents) {
				const authEvent = state.get(key);
				if (authEvent) {
					message.authedBy(authEvent);
				}
			}

			for await (const prev of stateService.getPrevEvents(message)) {
				message.addPreviousEvent(prev);
			}

			// TODO: not state event
			await stateService.saveMessage(message);

			// now to "transact" lol
			const transaction: Transaction = {
				origin: configService.getServerName(),
				origin_server_ts: Date.now(),
				pdus: [message.event],
				edus: [],
			};

			const members = await stateService.getMembersOfRoom(roomId);

			console.log('members', members);

			for (const member of members) {
				const domain = member.split(':').pop();
				if (domain === configService.getServerName()) {
					console.log('skipping self');
				} else if (domain) {
					console.log(`Sending transaction to ${domain}`);
					void federationService.sendTransaction(domain, transaction);
				}
			}

			return {
				event_id: message.eventId,
			};
		},
		{
			params: t.Object({
				roomId: t.String(),
			}),
			body: t.Object({
				text: t.String(),
				sender: t.String(),
			}),
		},
	);

	return app;
};
