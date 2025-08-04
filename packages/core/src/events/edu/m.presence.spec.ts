import { describe, expect, test } from 'bun:test';

import type { BaseEDU } from './base';
import {
	type PresenceEDU,
	type PresenceUpdate,
	createPresenceEDU,
	isPresenceEDU,
} from './m.presence';

describe('PresenceEDU', () => {
	describe('createPresenceEDU', () => {
		test('creates a valid presence EDU with single update', () => {
			const presenceUpdate: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'online',
			};

			const edu = createPresenceEDU([presenceUpdate]);

			expect(edu.edu_type).toBe('m.presence');
			expect(edu.content.push).toEqual([presenceUpdate]);
			expect(edu.origin).toBeUndefined();
		});

		test('creates a presence EDU with multiple updates', () => {
			const presenceUpdates: PresenceUpdate[] = [
				{
					user_id: '@user1:example.com',
					presence: 'online',
				},
				{
					user_id: '@user2:example.com',
					presence: 'offline',
					last_active_ago: 12345,
				},
			];

			const edu = createPresenceEDU(presenceUpdates);

			expect(edu.edu_type).toBe('m.presence');
			expect(edu.content.push).toEqual(presenceUpdates);
			expect(edu.content.push).toHaveLength(2);
		});

		test('creates a presence EDU with origin when provided', () => {
			const presenceUpdate: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'unavailable',
				last_active_ago: 5000,
			};
			const origin = 'example.com';

			const edu = createPresenceEDU([presenceUpdate], origin);

			expect(edu.edu_type).toBe('m.presence');
			expect(edu.content.push).toEqual([presenceUpdate]);
			expect(edu.origin).toBe(origin);
		});

		test('creates a presence EDU with all presence states', () => {
			const presenceUpdates: PresenceUpdate[] = [
				{ user_id: '@user1:example.com', presence: 'online' },
				{ user_id: '@user2:example.com', presence: 'offline' },
				{ user_id: '@user3:example.com', presence: 'unavailable' },
			];

			const edu = createPresenceEDU(presenceUpdates);

			expect(edu.content.push[0].presence).toBe('online');
			expect(edu.content.push[1].presence).toBe('offline');
			expect(edu.content.push[2].presence).toBe('unavailable');
		});

		test('creates a presence EDU with empty updates array', () => {
			const edu = createPresenceEDU([]);

			expect(edu.edu_type).toBe('m.presence');
			expect(edu.content.push).toEqual([]);
			expect(edu.content.push).toHaveLength(0);
		});
	});

	describe('isPresenceEDU', () => {
		test('returns true for valid presence EDU', () => {
			const presenceEDU: PresenceEDU = {
				edu_type: 'm.presence',
				content: {
					push: [
						{
							user_id: '@user1:example.com',
							presence: 'online',
						},
					],
				},
			};

			expect(isPresenceEDU(presenceEDU)).toBe(true);
		});

		test('returns false for non-presence EDU', () => {
			const nonPresenceEDU: BaseEDU = {
				edu_type: 'm.typing',
				content: {
					room_id: '!room:example.com',
					user_ids: ['@user1:example.com'],
				},
			};

			expect(isPresenceEDU(nonPresenceEDU)).toBe(false);
		});

		test('returns false for unknown EDU type', () => {
			const unknownEDU: BaseEDU = {
				edu_type: 'm.unknown',
				content: {},
			};

			expect(isPresenceEDU(unknownEDU)).toBe(false);
		});

		test('type guard correctly narrows type', () => {
			const presenceUpdate: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'online',
				last_active_ago: 1000,
			};
			const edu: BaseEDU = createPresenceEDU([presenceUpdate]);

			if (isPresenceEDU(edu)) {
				expect(edu.content.push).toEqual([presenceUpdate]);
				expect(edu.content.push[0].user_id).toBe('@user1:example.com');
				expect(edu.content.push[0].presence).toBe('online');
			} else {
				throw new Error('Type guard should have returned true');
			}
		});
	});

	describe('PresenceUpdate interface', () => {
		test('presence update with required fields only', () => {
			const update: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'online',
			};

			expect(update.user_id).toBe('@user1:example.com');
			expect(update.presence).toBe('online');
			expect(update.last_active_ago).toBeUndefined();
		});

		test('presence update with optional last_active_ago', () => {
			const update: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'unavailable',
				last_active_ago: 30000,
			};

			expect(update.user_id).toBe('@user1:example.com');
			expect(update.presence).toBe('unavailable');
			expect(update.last_active_ago).toBe(30000);
		});

		test('validates presence state values', () => {
			const validStates: Array<'online' | 'offline' | 'unavailable'> = [
				'online',
				'offline',
				'unavailable',
			];

			for (const state of validStates) {
				const update: PresenceUpdate = {
					user_id: '@user:example.com',
					presence: state,
				};

				expect(update.presence).toBe(state);
			}
		});
	});

	describe('PresenceEDU interface', () => {
		test('presence EDU has correct structure', () => {
			const presenceUpdate: PresenceUpdate = {
				user_id: '@user1:example.com',
				presence: 'online',
				last_active_ago: 5000,
			};
			const edu = createPresenceEDU([presenceUpdate], 'example.com');

			expect(edu).toHaveProperty('edu_type', 'm.presence');
			expect(edu).toHaveProperty('content');
			expect(edu.content).toHaveProperty('push');
			expect(edu).toHaveProperty('origin');

			expect(typeof edu.edu_type).toBe('string');
			expect(Array.isArray(edu.content.push)).toBe(true);
			expect(typeof edu.origin).toBe('string');

			const update = edu.content.push[0];
			expect(typeof update.user_id).toBe('string');
			expect(typeof update.presence).toBe('string');
			expect(typeof update.last_active_ago).toBe('number');
		});
	});
});
