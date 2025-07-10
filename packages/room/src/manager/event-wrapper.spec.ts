import { PersistentEventFactory } from './factory';

import { it, describe, expect } from 'bun:test';
import type { RoomVersion } from './type';

function runTest(
	event: Parameters<typeof PersistentEventFactory.createFromRawEvent>[0],
	expected: any,
	roomVersion: RoomVersion = '10',
) {
	expect(
		PersistentEventFactory.createFromRawEvent(event, roomVersion as RoomVersion)
			.redactedRawEvent,
	).toEqual(expected);
}

describe('[EventWrapper] Redaction', () => {
	it('minimal', () => {
		runTest(
			{
				// @ts-expect-error our types are production types
				type: 'A',
				event_id: '$test:domain',
			},
			{
				type: 'A',
				event_id: '$test:domain',
				content: {},
				signatures: {},
				unsigned: {},
			},
		);
	});

	it('basic keysi, Ensure that the keys that should be untouched are kept.', () => {
		const a = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			content: { other_key: 'foo' },
			hashes: 'hashes',
			signatures: { domain: { 'algo:1': 'sigs' } },
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			other_key: 'foo',
		};
		const b = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			hashes: 'hashes',
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			content: {},
			signatures: { domain: { 'algo:1': 'sigs' } },
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const a2 = {
			type: 'A',
			prev_state: 'prev_state',
			membership: 'join',
			origin: 'example.com',
		};
		const b2 = { type: 'A', content: {}, signatures: {}, unsigned: {} };
		// @ts-expect-error our types are production types
		runTest(a2, b2, '11');
	});

	it('unsigned, Ensure that unsigned properties get stripped (except age_ts and replaces_state).', () => {
		const a = {
			type: 'B',
			event_id: '$test:domain',
			unsigned: {
				age_ts: 20,
				replaces_state: '$test2:domain',
				other_key: 'foo',
			},
		};
		const b = {
			type: 'B',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: { age_ts: 20, replaces_state: '$test2:domain' },
		};

		// @ts-expect-error our types are production types
		runTest(a, b);
	});

	it('content, The content dictionary should be stripped in most cases.', () => {
		const a = {
			type: 'C',
			event_id: '$test:domain',
			content: { things: 'here' },
		};
		const b = {
			type: 'C',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const eventsToKeepContentKeys = [
			['member', 'membership', 'join'],
			['join_rules', 'join_rule', 'invite'],
			['history_visibility', 'history_visibility', 'shared'],
		];

		for (const [eventType, key, value] of eventsToKeepContentKeys) {
			const a = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value, other_key: 'foo' },
			};
			const b = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value },
				signatures: {},
				unsigned: {},
			};
			// @ts-expect-error our types are production types
			runTest(a, b);
		}
	});

	it('create, Create events are partially redacted until MSC2176.', () => {
		const a = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain', other_key: 'foo' },
		};
		const b = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error other_key  IS invalid and should be stripped
		runTest(a, b);

		const a2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			origin: 'some_homeserver',
			nonsense_field: 'some_random_garbage',
		};
		const b2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error not_a_real_key IS invalid but point is to test redaction
		runTest(a2, b2, '11');
	});

	it('power levels, Power level events keep a variety of content keys.', () => {
		const a: Parameters<typeof runTest>[0] = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				invite: 3,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
				// @ts-expect-error other_key IS invalid and should be stripped
				other_key: 8,
			},
		};
		const b = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
			},
			signatures: {},
			unsigned: {},
		};

		runTest(a, b);

		const a2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
		};
		const b2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error
		runTest(a2, b2, '11');
	});

	it('alias, Alias events have special behavior up through room version 6.', () => {
		const a = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
		};
		const b = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '5' /* < 6 */);

		const a2 = { type: 'm.room.aliases', content: { aliases: ['test'] } };
		const b2 = {
			type: 'm.room.aliases',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '6');
	});

	it('redaction, Redaction events have no special behaviour until MSC2174/MSC2176.', () => {
		const a = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b = {
			type: 'm.room.redaction',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '6');

		const a2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '11');
	});

	it('join rules, Join rules events have changed behavior starting with MSC3083.', () => {
		const a = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: {
				join_rule: 'invite',
				allow: [],
				other_key: 'stripped',
			},
		};
		const b = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: { join_rule: 'invite' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '7');

		// @ts-expect-error just redactions
		runTest(a, { ...b, content: { join_rule: 'invite', allow: [] } }, '8');
	});

	it('member, Member events have changed behavior in MSC3375 and MSC3821.', () => {
		const a2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
				other_key: 'stripped',
			},
		};
		const b2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
			},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '9');
		// TODO 3pid invite
	});

	it('relations, Event relations get redacted until MSC3389.', () => {
		const a = {
			type: 'm.room.message',
			content: {
				body: 'foo',
				'm.relates_to': {
					rel_type: 'rel_type',
					event_id: '$parent:domain',
					other: 'stripped',
				},
			},
		};
		const b = {
			type: 'm.room.message',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '10');

		// rest of the tests not yet part of normal standard
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
		// const nonmodifiedraw = {
		// 	content: { membership: 'join', displayname: 'debdut', avatar_url: null },
		// 	room_id: '!qxRocbYD:rc1.tunnel.dev.rocket.chat',
		// 	sender: '@debdut:syn1.tunnel.dev.rocket.chat',
		// 	state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
		// 	type: 'm.room.member',
		// 	origin_server_ts: 1750863043963,
		// 	depth: 0,
		// 	prev_events: [],
		// 	auth_events: [
		// 		'$v6h4nnBjnsAcSteUbI31FwumCou1NlX6mcgTT9yEyiY',
		// 		'$rWdS8WGy1yby1mKcsK349AgjJnmJP683ya2MAU0lNxU',
		// 	],
		// 	hashes: { sha256: 'jQcZtBAHpugkT0PzZ+TH1iQUiYT21M6ngai5bwIj9sA' },
		// 	origin: 'syn1.tunnel.dev.rocket.chat',
		// 	signatures: {
		// 		'syn1.tunnel.dev.rocket.chat': {
		// 			'ed25519:a_FAET':
		// 				'f9N1Mi3ciCjzvHIvq2Vy8IGXZSdaLuA0m6v7a45/2zq9100JIzXnYkqQLaTJvJ2PIzq/VUXNEN5D26IAFzYJCg',
		// 		},
		// 	},
		// 	unsigned: { age_ts: 1750863044315 },
		// };
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

		// biome-ignore lint/performance/noDelete: <explanation>
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

	it('...', async () => {
		const json = {
			auth_events: [
				'$AyLS4RhsSXjVXNbxi17Emfm84p-u44fSWTMRpYRm9wI',
				'$GOStPyEhlupxzL1_-DIaG1l7nS_nka1iOIP0OIFw4is',
			],
			prev_events: ['$AyLS4RhsSXjVXNbxi17Emfm84p-u44fSWTMRpYRm9wI'],
			type: 'm.room.power_levels',
			room_id: '!uvODOwXGMeEYZhbTmd:syn1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			content: {
				users: { '@debdut:syn1.tunnel.dev.rocket.chat': 100 },
				users_default: 0,
				events: {
					'm.room.name': 50,
					'm.room.avatar': 50,
					'm.room.power_levels': 100,
					'm.room.history_visibility': 100,
					'm.room.canonical_alias': 50,
					'm.room.tombstone': 100,
					'm.room.server_acl': 100,
					'm.room.encryption': 100,
					'org.matrix.msc3401.call.member': 0,
					'org.matrix.msc3401.call': 100,
				},
				events_default: 0,
				state_default: 50,
				ban: 50,
				kick: 50,
				redact: 50,
				invite: 50,
				historical: 100,
				'm.call.invite': 50,
			},
			depth: 3,
			state_key: '',
			origin: 'syn1.tunnel.dev.rocket.chat',
			origin_server_ts: 1751401341119,
			hashes: { sha256: 'wErvNqKOPP/qHLCQ1eV0M1Tgo5rqKI8tiMZIfYObGL0' },
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'guyGQ/84riJnzrrIlbeNyTn3gTWIUw5ja24pw5/1b79FukBcgUkVqzEQXb6+Kj7VmHLQU5Y8c5KyxxLF2O0BAw',
				},
			},
			unsigned: { age_ts: 1751401341119 },
		};

		const event = PersistentEventFactory.createFromRawEvent(json as any, '10');

		console.log(event.redactedEvent);

		console.log(event.eventId);
	});

	it('....', async () => {
		const raw = {
			auth_events: [
				'$be2V5ggCcgv0riartZC0SirRbbKfFiCzRE9pEHo_UXc',
				'$P9SW85SrIYtNNBHiN1mw6kBLTY7myvzzMvPeDOZDULs',
				'$70rAHJC-hyhv5FPQD8gM49--xWxjzFhmBjPY73YQNEg',
			],
			content: {
				avatar_url: null,
				displayname: 'debdut',
				membership: 'join',
			},
			depth: 0,
			hashes: {
				sha256: '4xuBnBMVP8RcpMw6BeRJ4nNt2/jKK/PHN73xNVaiLQk',
			},
			origin: 'syn1.tunnel.dev.rocket.chat',
			origin_server_ts: 1751405849667,
			prev_events: ['$70rAHJC-hyhv5FPQD8gM49--xWxjzFhmBjPY73YQNEg'],
			room_id: '!pbQpPVgW:rc1.tunnel.dev.rocket.chat',
			sender: '@debdut:syn1.tunnel.dev.rocket.chat',
			signatures: {
				'syn1.tunnel.dev.rocket.chat': {
					'ed25519:a_FAET':
						'CNoTePFIa8/4frma0Atefyg/1Cy+HKvzt3DuIfLtyxBPqUZoQW2e99G3PiA4LZyDX4AqT0hZNmgOVd8ZzZCGCQ',
				},
			},
			state_key: '@debdut:syn1.tunnel.dev.rocket.chat',
			type: 'm.room.member',
			unsigned: {
				age: 1,
			},
		};

		const e = PersistentEventFactory.createFromRawEvent(raw as any, '11');

		console.log(e instanceof PersistentEventV11);
		console.log(e.redactedEvent);
		console.log(e.eventId);
	});
});

function runTest(event: any, expected: any, roomVersion: RoomVersion = '10') {
	expect(
		PersistentEventFactory.createFromRawEvent(event, roomVersion as RoomVersion)
			.redactedRawEvent,
	).toEqual(expected);
}

describe('[EventWrapper] Redaction', () => {
	it('minimal', () => {
		runTest(
			{
				// @ts-expect-error our types are production types
				type: 'A',
				event_id: '$test:domain',
			},
			{
				type: 'A',
				event_id: '$test:domain',
				content: {},
				signatures: {},
				unsigned: {},
			},
		);
	});

	it('basic keysi, Ensure that the keys that should be untouched are kept.', () => {
		const a = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			content: { other_key: 'foo' },
			hashes: 'hashes',
			signatures: { domain: { 'algo:1': 'sigs' } },
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			other_key: 'foo',
		};
		const b = {
			event_id: '$3:domain',
			type: 'A',
			room_id: '!1:domain',
			sender: '@2:domain',
			state_key: 'B',
			hashes: 'hashes',
			depth: 4,
			prev_events: 'prev_events',
			prev_state: 'prev_state',
			auth_events: 'auth_events',
			origin: 'domain',
			origin_server_ts: 1234,
			membership: 'join',
			content: {},
			signatures: { domain: { 'algo:1': 'sigs' } },
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const a2 = {
			type: 'A',
			prev_state: 'prev_state',
			membership: 'join',
			origin: 'example.com',
		};
		const b2 = { type: 'A', content: {}, signatures: {}, unsigned: {} };
		// @ts-expect-error our types are production types
		runTest(a2, b2, '11');
	});

	it('unsigned, Ensure that unsigned properties get stripped (except age_ts and replaces_state).', () => {
		const a = {
			type: 'B',
			event_id: '$test:domain',
			unsigned: {
				age_ts: 20,
				replaces_state: '$test2:domain',
				other_key: 'foo',
			},
		};
		const b = {
			type: 'B',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: { age_ts: 20, replaces_state: '$test2:domain' },
		};

		// @ts-expect-error our types are production types
		runTest(a, b);
	});

	it('content, The content dictionary should be stripped in most cases.', () => {
		const a = {
			type: 'C',
			event_id: '$test:domain',
			content: { things: 'here' },
		};
		const b = {
			type: 'C',
			event_id: '$test:domain',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error our types are production types
		runTest(a, b);

		const eventsToKeepContentKeys = [
			['member', 'membership', 'join'],
			['join_rules', 'join_rule', 'invite'],
			['history_visibility', 'history_visibility', 'shared'],
		];

		for (const [eventType, key, value] of eventsToKeepContentKeys) {
			const a = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value, other_key: 'foo' },
			};
			const b = {
				type: `m.room.${eventType}`,
				event_id: '$test:domain',
				content: { [key]: value },
				signatures: {},
				unsigned: {},
			};
			runTest(a, b);
		}
	});

	it('create, Create events are partially redacted until MSC2176.', () => {
		const a = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain', other_key: 'foo' },
		};
		const b = {
			type: 'm.room.create',
			event_id: '$test:domain',
			content: { creator: '@2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error other_key  IS invalid and should be stripped
		runTest(a, b);

		const a2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			origin: 'some_homeserver',
			nonsense_field: 'some_random_garbage',
		};
		const b2 = {
			type: 'm.room.create',
			content: { not_a_real_key: true },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error not_a_real_key IS invalid but point is to test redaction
		runTest(a2, b2, '11');
	});

	it('power levels, Power level events keep a variety of content keys.', () => {
		const a: Parameters<typeof runTest>[0] = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				invite: 3,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
				// @ts-expect-error other_key IS invalid and should be stripped
				other_key: 8,
			},
		};
		const b = {
			type: 'm.room.power_levels',
			event_id: '$test:domain',
			content: {
				ban: 1,
				events: { 'm.room.name': 100 },
				events_default: 2,
				kick: 4,
				redact: 5,
				state_default: 6,
				users: { '@admin:domain': 100 },
				users_default: 7,
			},
			signatures: {},
			unsigned: {},
		};

		runTest(a, b);

		const a2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
		};
		const b2 = {
			type: 'm.room.power_levels',
			content: { invite: 75 },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error
		runTest(a2, b2, '11');
	});

	it('alias, Alias events have special behavior up through room version 6.', () => {
		const a = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
		};
		const b = {
			type: 'm.room.aliases',
			event_id: '$test:domain',
			content: { aliases: ['test'] },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '5' /* < 6 */);

		const a2 = { type: 'm.room.aliases', content: { aliases: ['test'] } };
		const b2 = {
			type: 'm.room.aliases',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '6');
	});

	it('redaction, Redaction events have no special behaviour until MSC2174/MSC2176.', () => {
		const a = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b = {
			type: 'm.room.redaction',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '6');

		const a2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			redacts: '$test2:domain',
		};
		const b2 = {
			type: 'm.room.redaction',
			content: { redacts: '$test2:domain' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '11');
	});

	it('join rules, Join rules events have changed behavior starting with MSC3083.', () => {
		const a = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: {
				join_rule: 'invite',
				allow: [],
				other_key: 'stripped',
			},
		};
		const b = {
			type: 'm.room.join_rules',
			event_id: '$test:domain',
			content: { join_rule: 'invite' },
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '7');

		// @ts-expect-error just redactions
		runTest(a, { ...b, content: { join_rule: 'invite', allow: [] } }, '8');
	});

	it('member, Member events have changed behavior in MSC3375 and MSC3821.', () => {
		const a2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
				other_key: 'stripped',
			},
		};
		const b2 = {
			type: 'm.room.member',
			content: {
				membership: 'join',
				join_authorised_via_users_server: '@user:domain',
			},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a2, b2, '9');
		// TODO 3pid invite
	});

	it('relations, Event relations get redacted until MSC3389.', () => {
		const a = {
			type: 'm.room.message',
			content: {
				body: 'foo',
				'm.relates_to': {
					rel_type: 'rel_type',
					event_id: '$parent:domain',
					other: 'stripped',
				},
			},
		};
		const b = {
			type: 'm.room.message',
			content: {},
			signatures: {},
			unsigned: {},
		};

		// @ts-expect-error just redactions
		runTest(a, b, '10');

		// rest of the tests not yet part of normal standard
	});
});
