import { expect, test } from 'bun:test';
import { generateKeyPairsFromString } from '@hs/core';
import { PersistentEventFactory } from './factory';
import { signEvent } from '@hs/core';

const finalEventId = '$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4';
const roomId = '!uTqsSSWabZzthsSCNf:hs1';
const timestamp = 1733107418648;
const finalEvent = {
	auth_events: [],
	prev_events: [],
	type: 'm.room.create',
	room_id: roomId,
	sender: '@admin:hs1',
	content: {
		room_version: '10',
		creator: '@admin:hs1',
	},
	depth: 1,
	state_key: '',
	origin: 'hs1',
	origin_server_ts: timestamp,

	hashes: { sha256: 'XFkxvgXOT9pGz5Hbdo7tLlVN2SmWhQ9ifgsbLio/FEo' },

	signatures: {
		hs1: {
			'ed25519:a_HDhg':
				'rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg',
		},
	},
	unsigned: { age_ts: timestamp },
};

test('roomCreateEvent', async () => {
	const signature = await generateKeyPairsFromString(
		'ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw',
	);

	const sender = '@admin:hs1';

	const event = PersistentEventFactory.newCreateEvent(sender, '10');

	// hash was calculated when we accesses event, remove so it gets recalculated fresh
	const eventWithoutHash = {
		...event.event,
		hashes: undefined,
	};

	// recreate with contents of the finalEvent I don't have control over in passing
	// since migrating test, tryinmg tp stay as close
	const createEvent = PersistentEventFactory.createFromRawEvent<'10'>(
		{
			...eventWithoutHash,
			room_id: roomId,
			origin_server_ts: timestamp,
			unsigned: { age_ts: timestamp },
			depth: finalEvent.depth,
			// @ts-expect-error
			origin: finalEvent.origin,
		},
		finalEvent.content.room_version,
	);

	const signed = await signEvent(
		createEvent.redactedEvent as any,
		signature,
		'hs1',
		false,
	);

	expect({
		...signed,
		unsigned: createEvent.event.unsigned,
		content: createEvent.event.content,
	}).toStrictEqual(finalEvent as any);
	expect(signed).toHaveProperty(
		'signatures.hs1.ed25519:a_HDhg',
		'rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg',
	);

	const eventId = createEvent.eventId;

	expect(eventId).toBe(finalEventId);
});

// test('isRoomCreateEvent', () => {
// 	const validEvent = roomCreateEvent({
// 		roomId: '!someRoom:example.org',
// 		sender: '@user:example.org',
// 	});

// 	const invalidEvent = {
// 		...validEvent,
// 		type: 'm.room.member',
// 	};

// 	expect(isRoomCreateEvent(validEvent)).toBe(true);
// 	expect(isRoomCreateEvent(invalidEvent)).toBe(false);
// });
