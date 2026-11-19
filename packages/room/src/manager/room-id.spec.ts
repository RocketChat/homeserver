import { describe, expect, it } from 'bun:test';

import { createEventIdFromRoomId, isDomainlessRoomId, roomIdFromCreateEventId, roomServerName } from './room-id';
import type { EventID, RoomID } from '../types/_common';

const v12RoomId = '!CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o' as RoomID;
const createEventId = '$CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o' as EventID;

describe('room ids', () => {
	it('tells domainless (v12+) room ids from legacy ones', () => {
		expect(isDomainlessRoomId(v12RoomId)).toBe(true);
		expect(isDomainlessRoomId('!abc:example.com')).toBe(false);
	});

	it('round trips between a v12 room id and its create event id', () => {
		expect(createEventIdFromRoomId(v12RoomId)).toBe(createEventId);
		expect(roomIdFromCreateEventId(createEventId)).toBe(v12RoomId);
	});

	it('returns the server of a legacy room id', () => {
		expect(roomServerName('!abc:example.com')).toBe('example.com');
		expect(roomServerName('!abc:example.com:8448')).toBe('example.com:8448');
	});

	it('returns undefined instead of throwing for a domainless room id', () => {
		expect(roomServerName(v12RoomId)).toBeUndefined();
	});
});
