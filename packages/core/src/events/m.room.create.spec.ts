import { expect, test } from 'bun:test';

import {
	PersistentEventFactory,
	RoomVersion,
} from '@rocket.chat/federation-room';
import type { SignedEvent } from '../types';
import { generateId } from '../utils/generateId';
import { generateKeyPairsFromString } from '../utils/keys';
import { signEvent } from '../utils/signEvent';
import {
	type RoomCreateEvent,
	isRoomCreateEvent,
	roomCreateEvent,
} from './m.room.create';

const finalEventId = '$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4';
const finalEvent = {
	auth_events: [],
	prev_events: [],
	type: 'm.room.create',
	room_id: '!uTqsSSWabZzthsSCNf:hs1',
	sender: '@admin:hs1',
	content: {
		room_version: '10',
		creator: '@admin:hs1',
	},
	depth: 1,
	state_key: '',
	origin: 'hs1',
	origin_server_ts: 1733107418648,

	hashes: { sha256: 'XFkxvgXOT9pGz5Hbdo7tLlVN2SmWhQ9ifgsbLio/FEo' },

	signatures: {
		hs1: {
			'ed25519:a_HDhg':
				'rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg',
		},
	},
	unsigned: { age_ts: 1733107418648 },
};

test('roomCreateEvent', async () => {
	const signature = await generateKeyPairsFromString(
		'ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw',
	);

	const event = roomCreateEvent({
		roomId: '!uTqsSSWabZzthsSCNf:hs1',
		sender: '@admin:hs1',
		ts: 1733107418648,
	});

	const signed = await signEvent(event, signature, 'hs1');

	expect(signed).toStrictEqual(
		finalEvent as unknown as SignedEvent<RoomCreateEvent>,
	);
	expect(signed).toHaveProperty(
		'signatures.hs1.ed25519:a_HDhg',
		'rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg',
	);

	const eventId = generateId(signed);

	expect(eventId).toBe(finalEventId);
});

test('isRoomCreateEvent', () => {
	const validEvent = roomCreateEvent({
		roomId: '!someRoom:example.org',
		sender: '@user:example.org',
	});

	const invalidEvent = {
		...validEvent,
		type: 'm.room.member',
	};

	expect(isRoomCreateEvent(validEvent)).toBe(true);
	expect(isRoomCreateEvent(invalidEvent)).toBe(false);
});

const roomId = '!uTqsSSWabZzthsSCNf:hs1';
const timestamp = 1733107418648;

test('roomCreateEvent with factory', async () => {
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
	const createEvent = PersistentEventFactory.createFromRawEvent(
		{
			...eventWithoutHash,
			room_id: roomId,
			origin_server_ts: timestamp,
			unsigned: { age_ts: timestamp },
			depth: finalEvent.depth,
			origin: finalEvent.origin,
		},
		finalEvent.content.room_version as RoomVersion,
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
