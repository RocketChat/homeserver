import type { EventStore } from '../state_resolution/definitions/definitions';
import type { PduV1 } from '../types/v1';
import { PersistentEventBase } from './event-wrapper';
import { PersistentEventFactory } from './factory';

import { it, describe, expect, afterEach } from 'bun:test';

class MockStore implements EventStore {
	events: Map<string, PersistentEventBase> = new Map();

	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return eventIds.map(
			(eventId) => this.events.get(eventId) as PersistentEventBase,
		);
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map<string, PersistentEventBase>();
		for (const [, event] of this.events) {
			byHash.set(event.sha256hash.toString(), event);
		}

		return hashes.map((h) => byHash.get(h) as PersistentEventBase);
	}
}

const store = new MockStore();

describe('EventManager', () => {
	afterEach(() => {
		store.events.clear();
	});

	it('should handle auth_event differences in v1', async () => {
		const createEvent = PersistentEventFactory.createFromRawEvent(
			{
				event_id: 'create',
				room_id: '!1234567890:example.com',
				type: 'm.room.create' as const,
				state_key: '',
				content: {
					creator: 'alice',
					room_version: '1',
				},
				auth_events: [] as string[],
				prev_events: [] as string[],
			} as PduV1,
			'1',
		);

		const events = [
			PersistentEventFactory.createFromRawEvent(
				{
					event_id: 'join',
					room_id: '!1234567890:example.com',
					type: 'm.room.member',
					state_key: '@alice:example.com',
					content: {
						membership: 'join',
					},
					auth_events: ['create'],
					prev_events: [] as string[],
				} as PduV1,
				'1',
			),
			PersistentEventFactory.createFromRawEvent(
				{
					event_id: 'message',
					room_id: '!1234567890:example.com',
					type: 'm.room.message',
					state_key: '',
					content: {
						msgtype: 'm.text',
						body: 'Hello, world!',
					},
					auth_events: [
						{ sha256: createEvent.sha256hash.toString() },
						'join',
					] as (string | { sha256: string })[],
					prev_events: [] as string[],
				} as unknown as PduV1,
				'1',
			),
		];

		store.events.set('create', createEvent);
		store.events.set('join', events[0]);
		store.events.set('message', events[1]);

		const messageEvent = events[1];

		const authEvents = await messageEvent.getAuthorizationEvents(store);

		const ids = authEvents.map((e) => e.eventId);

		expect(ids).toEqual(['join', 'create']);
	});

	it('should generate id correctly', () => {
		const raw = {
			type: 'm.room.create',
			state_key: '',
			content: {
				room_version: '11',
				creator: '@alice:rc1.tunnel.dev.rocket.chat',
				'm.federate': true,
			},
			sender: '@alice:rc1.tunnel.dev.rocket.chat',
			origin_server_ts: 1750847871445,
			room_id: '!jCvPPkSI:rc1.tunnel.dev.rocket.chat',
			prev_events: [],
			auth_events: [],
			depth: 0,
			hashes: { sha256: 'dExPnuaGoXiPhDtTJaCjtd8OC3T1+U/4ujzhESVRK/o' },
			signatures: {
				'rc1.tunnel.dev.rocket.chat': {
					'ed25519:0':
						'klK20kbg49PwbJPIdXSZfd90Mc531Gs2l+9Gq+A6LB76jz3+27zVHJ3Ei9refhAVV2h+wbe/e/+dtJZLsRksDQ',
				},
			},
			unsigned: {},
		};

		const event = PersistentEventFactory.createFromRawEvent(raw as any, '11');

		const raw2 = {
			content: { membership: 'join', displayname: 'debdut', avatar_url: null },
			room_id: '!jCvPPkSI:rc1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
			type: 'm.room.member',
			origin_server_ts: 1750847883265,
			depth: 0,
			prev_events: [],
			auth_events: [
				'$/BAEy6W+6sqpjBQlX3dT+89lE0pzk8K3kBy9jXCUnco',
				'$Ah2h8XnWkDaLAPypw9iYyvN5JRLxBl9wFTYrw0uyX7k',
			],
			hashes: { sha256: 'MLyLppIvug7r7vYJjB34gICEUPStya7uVT1h55jz5oo' },
			origin: 'syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'jHbuONmrgioFDA8EZnF04xRgj0GoKb5Tf4CGpZSfl4OYuMHI+cunZnRTCAwWiEGvhG+cbsylBtKqbGvxarb4DA',
				},
			},
			unsigned: { age_ts: 1750847883580 },
		};
		const id2 = '$dH1zX1ny9/ZC5RBOGgqvk/AsKRaoTOxOqv1JqliFTa8';

		expect(event.eventId).toEqual(
			'$Ah2h8XnWkDaLAPypw9iYyvN5JRLxBl9wFTYrw0uyX7k',
		);

		const event2 = PersistentEventFactory.createFromRawEvent(raw2 as any, '11');

		expect(event2.eventId).toEqual(id2);
	});

	it('should generate right id (2)', () => {
		const raw = {
			content: {
				membership: 'join',
				displayname: 'debdut',
				avatar_url: undefined,
			},
			room_id: '!iwACeKkl:rc1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
			type: 'm.room.member',
			origin_server_ts: 1750862351471,
			depth: 0,
			prev_events: [],
			auth_events: [
				'$fg0FB4KRN/cno67qm3TgN0Pd87+/SLz0NuNOtrIqEJk',
				'$p8XITVPRslqUurUJ2CLonq+Q5cXphOXzHxu3Pfa/nMg',
			],
			hashes: { sha256: 'e1nEiwN5otlu0kv5v53hr8uzZ5ibcNhlAQpzEhm3OZA' },
			origin: 'syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'e2ZBLl+zgm4YYA+miWPk7VBbcWTW40obMvib8lMZx36a6ZnRbad8cXdq16StVDUXOIHPJLxLUQFXlvedhor+DQ',
				},
			},
			unsigned: { age_ts: 1750862351800 },
		};
		const id = '$NFGaJpYKt1SJHJyTpiC+792yCX40ytGqNep4QVtpriw';

		const event = PersistentEventFactory.createFromRawEvent(raw as any, '11');

		expect(event.eventId).toEqual(id);
	});

	it('are the eventids equal', () => {
		/*
		 * {'content': {'membership': 'join', 'displayname': 'debdut', 'avatar_url': None}, 'room_id': '!qxRocbYD:rc1.tunnel.dev.rocket.chat', 'sender': '@debdut:syn1.tunnel.dev.rocket.chat', 'state_key': '@debdut:syn1.tunnel.dev.rocket.chat', 'type': 'm.room.member', 'origin_server_ts': 1750863043963, 'depth': 0, 'prev_events': [], 'auth_events': ['$v6h4nnBjnsAcSteUbI31FwumCou1NlX6mcgTT9yEyiY', '$rWdS8WGy1yby1mKcsK349AgjJnmJP683ya2MAU0lNxU'], 'hashes': {'sha256': 'jQcZtBAHpugkT0PzZ+TH1iQUiYT21M6ngai5bwIj9sA'}, 'origin': 'syn1.tunnel.dev.rocket.chat', 'signatures': {'syn1.tunnel.dev.rocket.chat': {'ed25519:a_FAET': 'f9N1Mi3ciCjzvHIvq2Vy8IGXZSdaLuA0m6v7a45/2zq9100JIzXnYkqQLaTJvJ2PIzq/VUXNEN5D26IAFzYJCg'}}, 'unsigned': {'age_ts': 1750863044315}}
2025-06-25 20:20:44,316 - twisted - 281 - INFO - POST-1548 - id $p6tUwIuq+Q3VFmdK6tnl2eD9h81/l8CoExpiQWEKbWE
		*/
		const nonmodifiedraw = {
			content: { membership: 'join', displayname: 'debdut', avatar_url: null },
			room_id: '!qxRocbYD:rc1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
			type: 'm.room.member',
			origin_server_ts: 1750863043963,
			depth: 0,
			prev_events: [],
			auth_events: [
				'$v6h4nnBjnsAcSteUbI31FwumCou1NlX6mcgTT9yEyiY',
				'$rWdS8WGy1yby1mKcsK349AgjJnmJP683ya2MAU0lNxU',
			],
			hashes: { sha256: 'jQcZtBAHpugkT0PzZ+TH1iQUiYT21M6ngai5bwIj9sA' },
			origin: 'syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'f9N1Mi3ciCjzvHIvq2Vy8IGXZSdaLuA0m6v7a45/2zq9100JIzXnYkqQLaTJvJ2PIzq/VUXNEN5D26IAFzYJCg',
				},
			},
			unsigned: { age_ts: 1750863044315 },
		};
		const synapseRaw = {
			content: { membership: 'join', displayname: 'debdut', avatar_url: null },
			room_id: '!qxRocbYD:rc1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
			type: 'm.room.member',
			origin_server_ts: 1750863043963,
			hashes: { sha256: 'jQcZtBAHpugkT0PzZ+TH1iQUiYT21M6ngai5bwIj9sA' },
			depth: 0,
			prev_events: [],
			auth_events: [
				'$v6h4nnBjnsAcSteUbI31FwumCou1NlX6mcgTT9yEyiY',
				'$rWdS8WGy1yby1mKcsK349AgjJnmJP683ya2MAU0lNxU',
			],
			origin: 'syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'f9N1Mi3ciCjzvHIvq2Vy8IGXZSdaLuA0m6v7a45/2zq9100JIzXnYkqQLaTJvJ2PIzq/VUXNEN5D26IAFzYJCg',
				},
			},
			unsigned: { age_ts: 1750863044315 },
		};

		const synapseEvent = PersistentEventFactory.createFromRawEvent(
			synapseRaw as any,
			'11',
		);

		console.log(
			'content hash with origin',
			synapseEvent.getContentHashString(),
		);

		console.log(
			'is content hash with origin equal to without origin',
			synapseEvent.getContentHashString() === synapseRaw.hashes.sha256,
		);

		delete (synapseEvent as any).rawEvent.origin;

		console.log(
			'content hash without origin',
			synapseEvent.getContentHashString(),
		);

		const synapseId = '$p6tUwIuq+Q3VFmdK6tnl2eD9h81/l8CoExpiQWEKbWE';

		(synapseEvent as any).rawEvent.origin = 'syn1.tunnel.dev.rocket.chat';

		const ourcalculatedid = synapseEvent.eventId;

		expect(ourcalculatedid).toEqual(synapseId);

		// const event = PersistentEventFactory.createFromRawEvent(
		// 	synapseRaw as any,
		// 	'11',
		// );

		// console.log('synapse contenthash', event.getContentHashString());

		// // expect(event.eventId).toEqual(synapseId);

		// const ourRaw = {
		// 	type: 'm.room.member',
		// 	room_id: '!qxRocbYD:rc1.tunnel.dev.rocket.chat',
		// 	sender: '@debdut:syn1.tunnel.dev.rocket.chat',
		// 	state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
		// 	content: {
		// 		membership: 'join',
		// 		displayname: 'debdut',
		// 		avatar_url: null,
		// 	},
		// 	hashes: {
		// 		sha256: 'hLFJ/kaySWkrdx1S6faV7qNVK76Y/gFMdUc9LCV3vhc',
		// 	},
		// 	depth: 0,
		// 	prev_events: [],
		// 	auth_events: [
		// 		'$v6h4nnBjnsAcSteUbI31FwumCou1NlX6mcgTT9yEyiY',
		// 		'$rWdS8WGy1yby1mKcsK349AgjJnmJP683ya2MAU0lNxU',
		// 	],
		// 	// origin_server_ts: 1750863044682,
		// 	origin_server_ts: synapseRaw.origin_server_ts,
		// 	unsigned: {},
		// 	origin: 'syn1.tunnel.dev.rocket.chat',
		// 	signatures: {
		// 		'rc1.tunnel.dev.rocket.chat': {
		// 			'ed25519:0':
		// 				'PhSbou905umIRRN0VGl+fjKmZKXOfKf5BsRAuiXMAMlSd1fV8CJjvNPfZHCVqLEPKBdIFAuYhlNUzthHgglZAw',
		// 		},
		// 	},
		// };

		// const ourEvent = PersistentEventFactory.createFromRawEvent(
		// 	ourRaw as any,
		// 	'11',
		// );

		// console.log('our contenthash', ourEvent.getContentHashString());

		// expect(ourEvent.eventId).toEqual(synapseId);
	});
});
