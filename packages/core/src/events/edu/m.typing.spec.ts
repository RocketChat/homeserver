import { describe, expect, test } from 'bun:test';

import type { BaseEDU } from './base';
import { type TypingEDU, createTypingEDU, isTypingEDU } from './m.typing';

describe('TypingEDU', () => {
	describe('createTypingEDU', () => {
		test('creates a valid typing EDU with required fields', () => {
			const roomId = '!testroom:example.com';
			const userIds = ['@user1:example.com', '@user2:example.com'];

			const edu = createTypingEDU(roomId, userIds);

			expect(edu.edu_type).toBe('m.typing');
			expect(edu.content.room_id).toBe(roomId);
			expect(edu.content.user_ids).toEqual(userIds);
			expect(edu.origin).toBeUndefined();
		});

		test('creates a typing EDU with origin when provided', () => {
			const roomId = '!testroom:example.com';
			const userIds = ['@user1:example.com'];
			const origin = 'example.com';

			const edu = createTypingEDU(roomId, userIds, origin);

			expect(edu.edu_type).toBe('m.typing');
			expect(edu.content.room_id).toBe(roomId);
			expect(edu.content.user_ids).toEqual(userIds);
			expect(edu.origin).toBe(origin);
		});

		test('creates a typing EDU with empty user list', () => {
			const roomId = '!testroom:example.com';
			const userIds: string[] = [];

			const edu = createTypingEDU(roomId, userIds);

			expect(edu.edu_type).toBe('m.typing');
			expect(edu.content.room_id).toBe(roomId);
			expect(edu.content.user_ids).toEqual([]);
		});

		test('creates a typing EDU with single user', () => {
			const roomId = '!testroom:example.com';
			const userIds = ['@user1:example.com'];

			const edu = createTypingEDU(roomId, userIds);

			expect(edu.edu_type).toBe('m.typing');
			expect(edu.content.room_id).toBe(roomId);
			expect(edu.content.user_ids).toEqual(userIds);
			expect(edu.content.user_ids).toHaveLength(1);
		});
	});

	describe('isTypingEDU', () => {
		test('returns true for valid typing EDU', () => {
			const typingEDU: TypingEDU = {
				edu_type: 'm.typing',
				content: {
					room_id: '!testroom:example.com',
					user_ids: ['@user1:example.com'],
				},
			};

			expect(isTypingEDU(typingEDU)).toBe(true);
		});

		test('returns false for non-typing EDU', () => {
			const nonTypingEDU: BaseEDU = {
				edu_type: 'm.presence',
				content: {
					push: [{ user_id: '@user1:example.com', presence: 'online' }],
				},
			};

			expect(isTypingEDU(nonTypingEDU)).toBe(false);
		});

		test('returns false for unknown EDU type', () => {
			const unknownEDU: BaseEDU = {
				edu_type: 'm.unknown',
				content: {},
			};

			expect(isTypingEDU(unknownEDU)).toBe(false);
		});

		test('type guard correctly narrows type', () => {
			const edu: BaseEDU = createTypingEDU('!room:example.com', [
				'@user:example.com',
			]);

			if (isTypingEDU(edu)) {
				expect(edu.content.room_id).toBe('!room:example.com');
				expect(edu.content.user_ids).toEqual(['@user:example.com']);
			} else {
				throw new Error('Type guard should have returned true');
			}
		});
	});

	describe('TypingEDU interface', () => {
		test('typing EDU has correct structure', () => {
			const edu = createTypingEDU(
				'!room:example.com',
				['@user:example.com'],
				'example.com',
			);

			expect(edu).toHaveProperty('edu_type', 'm.typing');
			expect(edu).toHaveProperty('content');
			expect(edu.content).toHaveProperty('room_id');
			expect(edu.content).toHaveProperty('user_ids');
			expect(edu).toHaveProperty('origin');

			expect(typeof edu.edu_type).toBe('string');
			expect(typeof edu.content.room_id).toBe('string');
			expect(Array.isArray(edu.content.user_ids)).toBe(true);
			expect(typeof edu.origin).toBe('string');
		});
	});
});
