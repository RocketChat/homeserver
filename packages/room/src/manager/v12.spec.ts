import { describe, expect, it } from 'bun:test';

import { PersistentEventFactory } from './factory';
import type { RoomVersion } from './type';
import type { EventID, PduForType, RoomID, UserID } from '../types/_common';

const alice = '@alice:example.com' as UserID;
const bob = '@bob:example.com' as UserID;
const carol = '@carol:example.com' as UserID;

function memberEvent(roomId: RoomID, roomVersion: RoomVersion) {
	return PersistentEventFactory.createFromRawEvent<'m.room.member'>(
		{
			type: 'm.room.member',
			state_key: bob,
			sender: bob,
			room_id: roomId,
			content: { membership: 'join' },
			origin_server_ts: 1,
			depth: 2,
			prev_events: [],
			auth_events: [],
		},
		roomVersion,
	);
}

describe('room v12 events', () => {
	describe('create event', () => {
		it('has no room_id and derives the room id from its own event id', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12');

			expect(create.event.room_id).toBeUndefined();
			expect(create.roomId).toBe(`!${create.eventId.slice(1)}` as RoomID);
			expect(create.roomId).toMatch(/^![A-Za-z0-9_-]{43}$/);
			expect(create.residentServer).toBeUndefined();
		});

		it('binds the room id to the create content', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12');
			const withCreators = PersistentEventFactory.createFromRawEvent<'m.room.create'>(
				{ ...create.event, content: { ...create.getContent(), additional_creators: [bob] } },
				'12',
			);

			expect(withCreators.roomId).not.toBe(create.roomId);
		});

		it('keeps the same event and room id when rebuilt from the wire format', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12');
			const fromWire = PersistentEventFactory.createFromRawEvent<'m.room.create'>(create.event, '12');

			expect(fromWire.eventId).toBe(create.eventId);
			expect(fromWire.roomId).toBe(create.roomId);
		});

		it('records additional creators in content', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: [bob] });

			expect(create.getContent<PduForType<'m.room.create'>['content']>().additional_creators).toEqual([bob]);
		});

		it('refuses additional creators before v12', () => {
			expect(() => PersistentEventFactory.newCreateEvent(alice, '11', { additionalCreators: [bob] })).toThrow();
		});

		it('still generates a domain room id before v12', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '11');

			expect(create.event.room_id).toMatch(/^![A-Za-z]{8}:example\.com$/);
			expect(create.residentServer).toBe('example.com');
		});

		it('keeps every create content key, additional_creators included, when redacted', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: [bob] });

			expect(create.redactedEvent.content).toEqual({ room_version: '12', additional_creators: [bob] });
		});
	});

	describe('creators', () => {
		it('are the sender and the additional creators at v12', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: [bob, carol] });

			expect(create.getCreators()).toEqual(new Set([alice, bob, carol]));
		});

		it('are the sender alone at v11 and content.creator before', () => {
			expect(PersistentEventFactory.newCreateEvent(alice, '11').getCreators()).toEqual(new Set([alice]));
			expect(PersistentEventFactory.newCreateEvent(alice, '10').getCreators()).toEqual(new Set([alice]));
		});
	});

	describe('auth event selection', () => {
		it('never selects m.room.create from v12', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12');

			expect(memberEvent(create.roomId, '12').getAuthEventStateKeys()).not.toContain('m.room.create:');
		});

		it('still selects m.room.create before v12', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '11');

			expect(memberEvent(create.roomId, '11').getAuthEventStateKeys()).toContain('m.room.create:');
		});

		it('derives the create event id from any event of a v12 room', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '12');

			expect(memberEvent(create.roomId, '12').getCreateEventId()).toBe(create.eventId);
			expect(create.getCreateEventId()).toBe(create.eventId);
		});

		it('has no derivable create event id before v12', () => {
			const create = PersistentEventFactory.newCreateEvent(alice, '11');

			expect(memberEvent(create.roomId, '11').getCreateEventId()).toBeUndefined();
		});
	});

	it('keeps the v11 redaction format', () => {
		const fields = PersistentEventFactory.newRedactionEventFields('$target' as EventID, {}, '12');

		expect(fields).toEqual({ content: { redacts: '$target' as EventID } });
	});
});

describe('room version capabilities', () => {
	it('supports v12', () => {
		expect(PersistentEventFactory.supportedRoomVersions).toContain('12');
		expect(PersistentEventFactory.isSupportedRoomVersion('12')).toBe(true);
		expect(PersistentEventFactory.isSupportedRoomVersion('13')).toBe(false);
	});

	it.each([
		[
			'3',
			{
				roomIdFormat: 'random-with-domain',
				createEventInAuthEvents: true,
				privilegedCreators: false,
				stateResolution: 'v2',
				redactsInContent: false,
			},
		],
		[
			'10',
			{
				roomIdFormat: 'random-with-domain',
				createEventInAuthEvents: true,
				privilegedCreators: false,
				stateResolution: 'v2',
				redactsInContent: false,
			},
		],
		[
			'11',
			{
				roomIdFormat: 'random-with-domain',
				createEventInAuthEvents: true,
				privilegedCreators: false,
				stateResolution: 'v2',
				redactsInContent: true,
			},
		],
		[
			'12',
			{
				roomIdFormat: 'create-event-hash',
				createEventInAuthEvents: false,
				privilegedCreators: true,
				stateResolution: 'v2.1',
				redactsInContent: true,
			},
		],
	])('declares the capabilities of v%s', (roomVersion, capabilities) => {
		expect(PersistentEventFactory.getCapabilities(roomVersion)).toEqual(capabilities as never);
	});

	it('exposes the capabilities on events of that version', () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12');

		expect(create.capabilities).toBe(PersistentEventFactory.getCapabilities('12'));
	});
});
