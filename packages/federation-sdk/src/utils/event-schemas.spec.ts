import { describe, expect, it } from 'bun:test';

import { getEventSchemaForType } from './event-schemas';

const base = {
	room_id: '!room:hs1',
	sender: '@admin:hs1',
	origin_server_ts: 1733107418719,
	depth: 1,
	prev_events: [],
	auth_events: [],
};

const createEvent = { ...base, type: 'm.room.create', state_key: '' };
const redaction = { ...base, type: 'm.room.redaction' };
const target = '$8ftnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA';

function validate(event: object, roomVersion: string) {
	return getEventSchemaForType((event as { type: string }).type, roomVersion).safeParse(event).success;
}

describe('event schemas', () => {
	it('requires m.room.create content.creator before v11', () => {
		expect(validate({ ...createEvent, content: { room_version: '10', creator: '@admin:hs1' } }, '10')).toBe(true);
		expect(validate({ ...createEvent, content: { room_version: '10' } }, '10')).toBe(false);
	});

	it('does not require m.room.create content.creator from v11 on', () => {
		expect(validate({ ...createEvent, content: { room_version: '11' } }, '11')).toBe(true);
	});

	it('takes the redaction target from the top level before v11', () => {
		expect(validate({ ...redaction, redacts: target, content: {} }, '10')).toBe(true);
		expect(validate({ ...redaction, content: { redacts: target } }, '10')).toBe(false);
	});

	it('takes the redaction target from content from v11 on', () => {
		expect(validate({ ...redaction, content: { redacts: target } }, '11')).toBe(true);
		expect(validate({ ...redaction, redacts: target, content: {} }, '11')).toBe(false);
	});

	it('resolves a schema for every supported room version', () => {
		for (const roomVersion of ['3', '4', '5', '6', '7', '8', '9', '10']) {
			expect(validate({ ...createEvent, content: { room_version: roomVersion, creator: '@admin:hs1' } }, roomVersion)).toBe(true);
		}
	});

	it('falls back to the permissive base schema for unknown event types', () => {
		expect(validate({ ...base, type: 'com.example.custom', content: { anything: true } }, '11')).toBe(true);
	});
});
