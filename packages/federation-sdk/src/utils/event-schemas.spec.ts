import { describe, expect, it } from 'bun:test';

import { PersistentEventFactory } from '@rocket.chat/federation-room';

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
const otherTarget = '$AAAnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA';

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

	// rejecting this would mean dropping an event the rest of the federation accepted, so a v11
	// redaction carrying the legacy top level field is accepted and the field ignored
	it('tolerates a legacy top level redacts in v11 and resolves the target from content', () => {
		const withBoth = { ...redaction, redacts: otherTarget, content: { redacts: target } };

		expect(validate(withBoth, '11')).toBe(true);

		expect(PersistentEventFactory.createFromRawEvent(withBoth as never, '11').getRedacts()).toBe(target);
	});

	it('resolves a schema for every supported room version', () => {
		for (const roomVersion of PersistentEventFactory.supportedRoomVersions) {
			// creator is required before v11 and dropped from v11 on
			const content = Number(roomVersion) < 11 ? { room_version: roomVersion, creator: '@admin:hs1' } : { room_version: roomVersion };

			expect(validate({ ...createEvent, content }, roomVersion)).toBe(true);
		}
	});

	it('falls back to the permissive base schema for unknown event types', () => {
		expect(validate({ ...base, type: 'com.example.custom', content: { anything: true } }, '11')).toBe(true);
	});
});
