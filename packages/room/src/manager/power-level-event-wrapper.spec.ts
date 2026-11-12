import { describe, expect, it } from 'bun:test';

import { PersistentEventFactory } from './factory';
import { PowerLevelEvent } from './power-level-event-wrapper';
import type { RoomVersion } from './type';
import type { RoomID, UserID } from '../types/_common';
import type { PduPowerLevelsEventContent } from '../types/v3-11';

const alice = '@alice:example.com' as UserID;
const bob = '@bob:example.com' as UserID;
const carol = '@carol:example.com' as UserID;

function powerLevels(roomId: RoomID, roomVersion: RoomVersion, content: PduPowerLevelsEventContent) {
	return PersistentEventFactory.createFromRawEvent<'m.room.power_levels'>(
		{
			type: 'm.room.power_levels',
			state_key: '',
			sender: alice,
			room_id: roomId,
			content,
			origin_server_ts: 1,
			depth: 3,
			prev_events: [],
			auth_events: [],
		},
		roomVersion,
	).toPowerLevelEvent();
}

describe('PowerLevelEvent.getPowerLevelForUser', () => {
	describe('v12', () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12', { additionalCreators: [bob] });

		it('is infinite for every creator without a power levels event', () => {
			expect(PowerLevelEvent.fromDefault().getPowerLevelForUser(alice, create)).toBe(Infinity);
			expect(PowerLevelEvent.fromDefault().getPowerLevelForUser(bob, create)).toBe(Infinity);
			expect(PowerLevelEvent.fromDefault().getPowerLevelForUser(carol, create)).toBe(0);
		});

		it('is infinite for every creator whatever the power levels say', () => {
			const pl = powerLevels(create.roomId, '12', { users: { [carol]: 100 }, users_default: 1000 });

			expect(pl.getPowerLevelForUser(alice, create)).toBe(Infinity);
			expect(pl.getPowerLevelForUser(bob, create)).toBe(Infinity);
			expect(pl.getPowerLevelForUser(carol, create)).toBe(100);
		});
	});

	describe('v11', () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '11');

		it('defaults the creator to 100 without a power levels event', () => {
			expect(PowerLevelEvent.fromDefault().getPowerLevelForUser(alice, create)).toBe(100);
			expect(PowerLevelEvent.fromDefault().getPowerLevelForUser(bob, create)).toBe(0);
		});

		it('uses the listed value, the creator is not privileged', () => {
			const pl = powerLevels(create.roomId, '11', { users: { [alice]: 50, [bob]: 100 } });

			expect(pl.getPowerLevelForUser(alice, create)).toBe(50);
			expect(pl.getPowerLevelForUser(bob, create)).toBe(100);
		});
	});

	it('lists the users of the power levels content', () => {
		const create = PersistentEventFactory.newCreateEvent(alice, '12');

		expect(powerLevels(create.roomId, '12', { users: { [bob]: 50, [carol]: 0 } }).getUserIds()).toEqual([bob, carol]);
		expect(PowerLevelEvent.fromDefault().getUserIds()).toEqual([]);
	});
});
