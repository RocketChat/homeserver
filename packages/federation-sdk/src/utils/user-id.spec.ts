import { describe, expect, it } from 'bun:test';

import { isUserId } from './user-id';

describe('isUserId', () => {
	it.each([
		'@alice:example.com',
		'@alice:example.com:8448',
		'@alice:127.0.0.1',
		'@alice:[::1]:8448',
		'@Alice.Smith=1/2+3-4_5:example.com',
		// historical localparts allow any printable ascii but ':'
		'@!old$school:example.com',
	])('accepts %s', (value) => {
		expect(isUserId(value)).toBe(true);
	});

	it.each([
		'',
		'alice:example.com',
		'@alice',
		'@:example.com',
		'@alice:',
		'_@alice:example.com_DEVICE_m.call',
		'@alice:example.com_DEVICE',
		'@alice:example.com:port',
		'@ali ce:example.com',
		'm.call#ROOM',
		`@${'a'.repeat(250)}:example.com`,
	])('rejects %s', (value) => {
		expect(isUserId(value)).toBe(false);
	});
});
