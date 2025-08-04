import { describe, expect, test } from 'bun:test';

import { isFederationEDUResponse, isMatrixEDU } from './base';
import type { BaseEDU } from './base';
import type { MatrixEDUTypes } from './index';
import { createPresenceEDU, isPresenceEDU } from './m.presence';
import { createTypingEDU, isTypingEDU } from './m.typing';

describe('EDU Index', () => {
	describe('MatrixEDUTypes union type', () => {
		test('accepts TypingEDU', () => {
			const typingEDU = createTypingEDU('!room:example.com', [
				'@user:example.com',
			]);

			// This should compile without TypeScript errors
			const eduUnion: MatrixEDUTypes = typingEDU;

			expect(eduUnion.edu_type).toBe('m.typing');
		});

		test('accepts PresenceEDU', () => {
			const presenceEDU = createPresenceEDU([
				{
					user_id: '@user:example.com',
					presence: 'online',
				},
			]);

			// This should compile without TypeScript errors
			const eduUnion: MatrixEDUTypes = presenceEDU;

			expect(eduUnion.edu_type).toBe('m.presence');
		});

		test('accepts BaseEDU', () => {
			const baseEDU: BaseEDU = {
				edu_type: 'm.custom',
				content: { test: 'data' },
			};

			// This should compile without TypeScript errors
			const eduUnion: MatrixEDUTypes = baseEDU;

			expect(eduUnion.edu_type).toBe('m.custom');
		});

		test('union type preserves specific EDU properties', () => {
			const typingEDU = createTypingEDU('!room:example.com', [
				'@user:example.com',
			]);
			const presenceEDU = createPresenceEDU([
				{
					user_id: '@user:example.com',
					presence: 'online',
				},
			]);

			const edus: MatrixEDUTypes[] = [typingEDU, presenceEDU];

			expect(edus).toHaveLength(2);
			expect(edus[0].edu_type).toBe('m.typing');
			expect(edus[1].edu_type).toBe('m.presence');
		});

		test('can be used in discriminated union patterns', () => {
			const edus: MatrixEDUTypes[] = [
				createTypingEDU('!room:example.com', ['@user:example.com']),
				createPresenceEDU([
					{ user_id: '@user:example.com', presence: 'online' },
				]),
			];

			for (const edu of edus) {
				switch (edu.edu_type) {
					case 'm.typing':
						// TypeScript should know this is a TypingEDU
						expect(edu.content).toHaveProperty('room_id');
						expect(edu.content).toHaveProperty('user_ids');
						break;
					case 'm.presence':
						// TypeScript should know this is a PresenceEDU
						expect(edu.content).toHaveProperty('push');
						break;
					default:
						// Generic BaseEDU case
						expect(edu.content).toBeDefined();
				}
			}
		});
	});

	describe('Module exports', () => {
		test('exports all required types and functions', () => {
			// Test that all functions are available via imports
			expect(typeof createTypingEDU).toBe('function');
			expect(typeof isTypingEDU).toBe('function');
			expect(typeof createPresenceEDU).toBe('function');
			expect(typeof isPresenceEDU).toBe('function');
			expect(typeof isMatrixEDU).toBe('function');
			expect(typeof isFederationEDUResponse).toBe('function');
		});
	});
});
