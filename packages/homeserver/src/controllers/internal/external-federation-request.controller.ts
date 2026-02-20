import {
	type Pdu,
	type PduPowerLevelsEventContent,
	type PduType,
	PersistentEventFactory,
	type RoomID,
	type RoomVersion,
	type UserID,
} from '@rocket.chat/federation-room';
import { federationSDK } from '@rocket.chat/federation-sdk';
import type { Elysia } from 'elysia';
import { t } from 'elysia';

export const internalRequestPlugin = (app: Elysia) => {
	app.post(
		'/internal/request',
		async ({ body }) => {
			const { method, body: requestBody, uri, serverName, query } = body;
			const response = await federationSDK.makeSignedRequest({
				domain: serverName,
				uri,
				method,
				body: requestBody,
				queryString: query ? new URLSearchParams(query).toString() : undefined,
			});

			return response.json();
		},
		{
			body: t.Object({
				serverName: t.String({
					description: 'where the request will go to, like matrix.org',
				}),
				uri: t.String({
					description: 'the endpoint uri, roomid user id and all',
				}),
				body: t.Optional(t.Any({ description: 'the body to send, if any' })),
				method: t.Union([t.Literal('GET'), t.Literal('POST'), t.Literal('PUT')], {
					description: 'the method to use',
				}),
				query: t.Optional(
					t.Record(t.String(), t.String(), {
						description: 'query parameters to append to the url',
						default: {},
					}),
				),
			}),
			detail: {
				tags: ['Devtools'],
				summary: 'Request other homeserver anything',
				description: 'Request other homeserver anything',
			},
		},
	);

	app.get(
		'/internal/event/template/:eventType/:roomId/:sender',
		async ({ params, query }) => {
			const { eventType, roomId, sender } = params as {
				eventType: PduType;
				roomId: RoomID;
				sender: UserID;
			};
			const version = (query.version as RoomVersion | undefined) || PersistentEventFactory.defaultRoomVersion;
			switch (eventType) {
				case 'm.room.member': {
					const event = await federationSDK.buildEvent<'m.room.member'>(
						{
							type: 'm.room.member',
							room_id: roomId,
							sender,
							state_key: sender,
							content: { membership: 'join' },
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				case 'm.room.message': {
					const event = await federationSDK.buildEvent<'m.room.message'>(
						{
							type: 'm.room.message',
							room_id: roomId,
							sender,
							content: { msgtype: 'm.text', body: 'hello world' },
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				case 'm.room.power_levels': {
					// is the an existingh one?
					let content: PduPowerLevelsEventContent = {
						users: { [sender]: 100 },
						users_default: 0,
						events: {},
						events_default: 0,
						state_default: 50,
					};
					try {
						const currState = await federationSDK.getLatestRoomState2(roomId);
						if (currState.powerLevels) {
							content = currState.powerLevels;
						}
					} catch {
						// noop
					}
					const event = await federationSDK.buildEvent<'m.room.power_levels'>(
						{
							type: 'm.room.power_levels',
							room_id: roomId,
							sender,
							state_key: '',
							content,
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				case 'm.room.join_rules': {
					const event = await federationSDK.buildEvent<'m.room.join_rules'>(
						{
							type: 'm.room.join_rules',
							room_id: roomId,
							sender,
							state_key: '',
							content: { join_rule: 'public' },
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				case 'm.room.topic': {
					const event = await federationSDK.buildEvent<'m.room.topic'>(
						{
							type: 'm.room.topic',
							room_id: roomId,
							sender,
							state_key: '',
							content: { topic: 'topic' },
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				case 'm.room.name': {
					const event = await federationSDK.buildEvent<'m.room.name'>(
						{
							type: 'm.room.name',
							room_id: roomId,
							sender,
							state_key: '',
							content: { name: 'new room name' },
							auth_events: [],
							prev_events: [],
							origin_server_ts: Date.now(),
							depth: 0,
						},
						version,
					);
					return event.event;
				}
				default:
					throw new Error('Unsupported event type');
			}
		},
		{
			params: t.Object({
				eventType: t.String(),
				roomId: t.String(),
				sender: t.String(),
			}),
			query: t.Optional(t.Object({ version: t.String() })),
			detail: {
				tags: ['Devtools'],
				summary: 'Event template',
				description: 'Get an event template to fill and send, use /internal/event/send to send it',
			},
		},
	);

	app.put(
		'/internal/event/send',
		async ({ body, query }) => {
			const event = body as Pdu;
			const version = (query.version as RoomVersion | undefined) || PersistentEventFactory.defaultRoomVersion;
			if (!PersistentEventFactory.isSupportedRoomVersion(version)) {
				throw new Error(`Room version ${version} is not supported`);
			}
			// @ts-ignore
			event.hashes = undefined; // force to be recalculated
			const pdu = PersistentEventFactory.createFromRawEvent(event, version);
			if (!pdu) {
				throw new Error('Failed to create persistent event from event');
			}
			await federationSDK.handlePdu(pdu);
			void federationSDK.sendEventToAllServersInRoom(pdu);
			return { event_id: pdu.eventId, event: pdu.event };
		},
		{
			body: t.Any(),
			query: t.Object({ version: t.String({ default: '10' }) }),
			detail: {
				tags: ['Devtools'],
				summary: 'Send an event',
				description: 'Send an event, you can get templates from /internal/event/template/:eventType/:roomId/:sender',
			},
		},
	);

	return app;
};
