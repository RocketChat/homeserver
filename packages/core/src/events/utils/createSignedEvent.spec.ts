import { describe, expect, test } from 'bun:test';

import { generateKeyPairsFromString } from '../../utils/keys';
import { signEvent } from '../../utils/signEvent';
import { roomCreateEvent } from '../m.room.create';
import { createSignedEvent } from './createSignedEvent';

describe('makeSignedEvent', () => {
	test('it should return the same payload, following create event > sign', async () => {
		const signature = await generateKeyPairsFromString('ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U');

		const args = {
			roomId: '!uTqsSSWabZzthsSCNf:hs1',
			sender: '@admin:hs1',
			ts: 1733069433734,
		};

		const signed = await signEvent(roomCreateEvent(args), signature, 'hs1');

		const makeSignedEvent = createSignedEvent(signature, 'hs1');
		const result = await makeSignedEvent(roomCreateEvent)(args);

		expect(result).toStrictEqual(signed);
	});
});
