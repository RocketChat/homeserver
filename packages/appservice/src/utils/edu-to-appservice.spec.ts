import { describe, expect, test } from 'bun:test';

import type { PresenceEDU, ReceiptEDU, TypingEDU } from '@rocket.chat/federation-core';

import { eduBatchToAppServiceEphemeral } from './edu-to-appservice';

const typingEDU = (room_id: string, user_id: string, typing: boolean): TypingEDU => ({
	edu_type: 'm.typing',
	content: { room_id, user_id, typing },
});

const presenceEDU = (push: PresenceEDU['content']['push']): PresenceEDU => ({
	edu_type: 'm.presence',
	content: { push },
});

describe('eduBatchToAppServiceEphemeral', () => {
	describe('typing', () => {
		test('single typing=true emits one event with one user', () => {
			const out = eduBatchToAppServiceEphemeral([typingEDU('!r:s', '@u:s', true)]);
			expect(out).toEqual([{ type: 'm.typing', room_id: '!r:s', content: { user_ids: ['@u:s'] } }]);
		});

		test('two users typing in same room coalesce into one event', () => {
			const out = eduBatchToAppServiceEphemeral([typingEDU('!r:s', '@u1:s', true), typingEDU('!r:s', '@u2:s', true)]);
			expect(out).toHaveLength(1);
			expect(out[0].type).toBe('m.typing');
			expect(out[0].room_id).toBe('!r:s');
			expect((out[0].content as { user_ids: string[] }).user_ids.sort()).toEqual(['@u1:s', '@u2:s']);
		});

		test('typing=false only emits one event with empty user_ids', () => {
			const out = eduBatchToAppServiceEphemeral([typingEDU('!r:s', '@u:s', false)]);
			expect(out).toEqual([{ type: 'm.typing', room_id: '!r:s', content: { user_ids: [] } }]);
		});

		test('start-then-stop for same user in one batch removes them from user_ids', () => {
			const out = eduBatchToAppServiceEphemeral([typingEDU('!r:s', '@u:s', true), typingEDU('!r:s', '@u:s', false)]);
			expect(out).toEqual([{ type: 'm.typing', room_id: '!r:s', content: { user_ids: [] } }]);
		});

		test('typing across two rooms emits two events', () => {
			const out = eduBatchToAppServiceEphemeral([typingEDU('!a:s', '@u:s', true), typingEDU('!b:s', '@u:s', true)]);
			expect(out).toHaveLength(2);
			const byRoom = Object.fromEntries(out.map((e) => [e.room_id, e]));
			expect(byRoom['!a:s'].content).toEqual({ user_ids: ['@u:s'] });
			expect(byRoom['!b:s'].content).toEqual({ user_ids: ['@u:s'] });
		});
	});

	describe('receipts', () => {
		test('single room/user/event receipt is correctly transformed', () => {
			const edu: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					'!r:s': {
						'm.read': {
							'@u:s': { data: { ts: 1700000000000 }, event_ids: ['$evt:s'] },
						},
					},
				},
			};
			expect(eduBatchToAppServiceEphemeral([edu])).toEqual([
				{
					type: 'm.receipt',
					room_id: '!r:s',
					content: { '$evt:s': { 'm.read': { '@u:s': { ts: 1700000000000 } } } },
				},
			]);
		});

		test('thread_id is preserved on the receipt user entry', () => {
			const edu: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					'!r:s': {
						'm.read': {
							'@u:s': { data: { ts: 1700000000000, thread_id: 'main' }, event_ids: ['$evt:s'] },
						},
					},
				},
			};
			const out = eduBatchToAppServiceEphemeral([edu]);
			expect(out[0].content).toEqual({
				'$evt:s': { 'm.read': { '@u:s': { ts: 1700000000000, thread_id: 'main' } } },
			});
		});

		test('multiple event_ids for one user fan out into separate event_id keys', () => {
			const edu: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					'!r:s': {
						'm.read': {
							'@u:s': { data: { ts: 1700000000000 }, event_ids: ['$a:s', '$b:s'] },
						},
					},
				},
			};
			const out = eduBatchToAppServiceEphemeral([edu]);
			expect(out).toHaveLength(1);
			expect(out[0].content).toEqual({
				'$a:s': { 'm.read': { '@u:s': { ts: 1700000000000 } } },
				'$b:s': { 'm.read': { '@u:s': { ts: 1700000000000 } } },
			});
		});

		test('two receipts for the same room within a batch merge into one event', () => {
			const eduA: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					'!r:s': { 'm.read': { '@u1:s': { data: { ts: 1 }, event_ids: ['$a:s'] } } },
				},
			};
			const eduB: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					'!r:s': { 'm.read': { '@u2:s': { data: { ts: 2 }, event_ids: ['$b:s'] } } },
				},
			};
			const out = eduBatchToAppServiceEphemeral([eduA, eduB]);
			expect(out).toHaveLength(1);
			expect(out[0].room_id).toBe('!r:s');
			expect(out[0].content).toEqual({
				'$a:s': { 'm.read': { '@u1:s': { ts: 1 } } },
				'$b:s': { 'm.read': { '@u2:s': { ts: 2 } } },
			});
		});
	});

	describe('presence', () => {
		test('two pushes fan out into two events with sender hoisted', () => {
			const edu = presenceEDU([
				{ user_id: '@u1:s', presence: 'online', last_active_ago: 5000 },
				{ user_id: '@u2:s', presence: 'offline' },
			]);
			const out = eduBatchToAppServiceEphemeral([edu]);
			expect(out).toEqual([
				{ type: 'm.presence', sender: '@u1:s', content: { presence: 'online', last_active_ago: 5000 } },
				{ type: 'm.presence', sender: '@u2:s', content: { presence: 'offline' } },
			]);
		});

		test('user_id is stripped from content', () => {
			const out = eduBatchToAppServiceEphemeral([
				presenceEDU([{ user_id: '@u:s', presence: 'online', last_active_ago: 100, status_msg: 'hi' }]),
			]);
			expect(out[0].content).not.toHaveProperty('user_id');
			expect(out[0].content).toEqual({ presence: 'online', last_active_ago: 100, status_msg: 'hi' });
		});
	});

	describe('mixed batches', () => {
		test('returns typing + receipt + presence events from one mixed batch', () => {
			const out = eduBatchToAppServiceEphemeral([
				typingEDU('!r:s', '@u:s', true),
				{
					edu_type: 'm.receipt',
					content: {
						'!r:s': { 'm.read': { '@u:s': { data: { ts: 1 }, event_ids: ['$e:s'] } } },
					},
				} satisfies ReceiptEDU,
				presenceEDU([{ user_id: '@u:s', presence: 'online', last_active_ago: 0 }]),
			]);
			const types = out.map((e) => e.type).sort();
			expect(types).toEqual(['m.presence', 'm.receipt', 'm.typing']);
		});

		test('empty input returns empty array', () => {
			expect(eduBatchToAppServiceEphemeral([])).toEqual([]);
		});
	});
});
