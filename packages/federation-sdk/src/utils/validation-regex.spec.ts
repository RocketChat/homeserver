import { describe, expect, it } from 'bun:test';

import { ROOM_ID_REGEX } from './validation-regex';
import { RoomIdSchema } from '../specs/federation-api';

const v12RoomId = '!CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o';

describe('room id validation', () => {
	it('matches a legacy room id and captures its server', () => {
		expect('!abc:example.com'.match(ROOM_ID_REGEX)?.[1]).toBe('example.com');
	});

	it('matches a v12 room id without a server', () => {
		const match = v12RoomId.match(ROOM_ID_REGEX);

		expect(match).not.toBeNull();
		expect(match?.[1]).toBeUndefined();
	});

	it.each([
		['a bare sigil', '!'],
		['a 42 character hash', v12RoomId.slice(0, -1)],
		['a 44 character hash', `${v12RoomId}A`],
		['standard base64 characters', `!${'+'.repeat(43)}`],
	])('rejects %s', (_label, roomId) => {
		expect(ROOM_ID_REGEX.test(roomId)).toBe(false);
		expect(RoomIdSchema.safeParse(roomId).success).toBe(false);
	});

	it('accepts both formats in the federation api schema', () => {
		expect(RoomIdSchema.safeParse('!abc:example.com').success).toBe(true);
		expect(RoomIdSchema.safeParse(v12RoomId).success).toBe(true);
	});
});
