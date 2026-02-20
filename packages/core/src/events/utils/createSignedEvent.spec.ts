import { describe, expect, test } from 'bun:test';

import { generateId } from '../../utils/generateId';
import { generateKeyPairsFromString } from '../../utils/keys';
import { signEvent } from '../../utils/signEvent';
import { createRoomCreateEvent, roomCreateEvent } from '../m.room.create';
import { createSignedEvent } from './createSignedEvent';

describe('makeSignedEvent', () => {
	test('it should return the same payload, following create event > sign > generate id', async () => {
		const signature = await generateKeyPairsFromString('ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U');

		const event = roomCreateEvent({
			roomId: '!uTqsSSWabZzthsSCNf:hs1',
			sender: '@admin:hs1',
			ts: 1733069433734,
		});
		const signed = await signEvent(event, signature, 'hs1');
		const id = generateId(signed);

		const makeSignedEvent = createSignedEvent(signature, 'hs1');
		const result = await createRoomCreateEvent(makeSignedEvent)({
			roomId: '!uTqsSSWabZzthsSCNf:hs1',
			sender: '@admin:hs1',
			ts: 1733069433734,
		});

		expect({
			event: signed,
			_id: id,
			// @ts-expect-error --- IGNORE ---
		}).toStrictEqual(result);
	});
});
