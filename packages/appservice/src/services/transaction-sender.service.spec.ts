import 'reflect-metadata';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TypingEDU } from '@rocket.chat/federation-core';
import type { PersistentEventBase } from '@rocket.chat/federation-room';

import { TransactionSenderService } from './transaction-sender.service';
import type { AppServiceTransaction, CachedAppService } from '../models/appservice.model';
import type { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import type { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';

const AS_ID = 'xmpp';

// Real HTTP endpoint for deliveries (the core fetch helper uses node:http, so a
// local server exercises the actual delivery path). Toggle `respondStatus` to
// simulate the bridge going down/up.
let server: ReturnType<typeof Bun.serve>;
let respondStatus = 200;
let received: Array<{ path: string; body: Record<string, unknown> }> = [];

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch: async (req) => {
			received.push({ path: new URL(req.url).pathname, body: (await req.json().catch(() => ({}))) as Record<string, unknown> });
			return new Response('{}', { status: respondStatus, headers: { 'Content-Type': 'application/json' } });
		},
	});
});

afterAll(() => {
	server.stop(true);
});

// Recoverer waits are intercepted so backoff is controllable and instant;
// short delays (test plumbing) pass through to the real timer.
const realSetTimeout = globalThis.setTimeout;
const scheduled: Array<{ delayMs: number; cb: () => void }> = [];

function makeAppService(): CachedAppService {
	return {
		registration: { _id: AS_ID, url: `http://127.0.0.1:${server.port}`, hsToken: 'hs-token', asToken: 'as-token' },
	} as unknown as CachedAppService;
}

function makeEvent(id: string): PersistentEventBase {
	return { eventId: id, event: { type: 'm.room.message' } } as unknown as PersistentEventBase;
}

const typingEdu = { edu_type: 'm.typing', content: { room_id: '!r:s', user_id: '@u:s', typing: true } } as TypingEDU;

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error('waitUntil timed out');
		}
		// eslint-disable-next-line no-await-in-loop
		await new Promise((r) => realSetTimeout(r, 5));
	}
}

describe('TransactionSenderService', () => {
	let service: TransactionSenderService;
	let appservice: CachedAppService;
	let states: Map<string, 'up' | 'down'>;
	let txns: AppServiceTransaction[];
	let txnCounter: number;
	let stateRepo: {
		getState: ReturnType<typeof mock>;
		markUp: ReturnType<typeof mock>;
		markDown: ReturnType<typeof mock>;
		incrementTxnId: ReturnType<typeof mock>;
	};
	let txnRepo: {
		create: ReturnType<typeof mock>;
		getOldestPending: ReturnType<typeof mock>;
		complete: ReturnType<typeof mock>;
	};

	beforeEach(() => {
		respondStatus = 200;
		received = [];
		scheduled.length = 0;
		txnCounter = 0;
		states = new Map([[AS_ID, 'up']]);
		txns = [];

		globalThis.setTimeout = ((cb: () => void, delayMs?: number, ...args: unknown[]) => {
			if ((delayMs ?? 0) >= 1000) {
				scheduled.push({ delayMs: delayMs ?? 0, cb });
				return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
			}
			return realSetTimeout(cb, delayMs, ...args);
		}) as typeof setTimeout;

		stateRepo = {
			getState: mock(async (asId: string) => ({ _id: asId, state: states.get(asId) ?? 'up' })),
			markUp: mock(async (asId: string) => {
				states.set(asId, 'up');
			}),
			markDown: mock(async (asId: string) => {
				states.set(asId, 'down');
			}),
			incrementTxnId: mock(async () => ++txnCounter),
		};

		txnRepo = {
			create: mock(async (txn: AppServiceTransaction) => {
				txns.push(txn);
			}),
			getOldestPending: mock(async (asId: string) => txns.filter((t) => t.asId === asId).sort((a, b) => a.txnId - b.txnId)[0] ?? null),
			complete: mock(async (asId: string, txnId: number) => {
				const index = txns.findIndex((t) => t.asId === asId && t.txnId === txnId);
				if (index >= 0) {
					txns.splice(index, 1);
				}
			}),
		};

		service = new TransactionSenderService(
			stateRepo as unknown as AppServiceStateRepository,
			txnRepo as unknown as AppServiceTransactionRepository,
		);
		service.setEventResolver(async (eventIds) => eventIds.map((id) => ({ event_id: id, type: 'm.room.message' })));
		appservice = makeAppService();
	});

	afterEach(() => {
		globalThis.setTimeout = realSetTimeout;
	});

	test('successful live send delivers inline and deletes the row without touching state', async () => {
		await service.sendTransaction(appservice, [makeEvent('$e1')]);

		expect(received).toHaveLength(1);
		expect(received[0].path).toBe('/_matrix/app/v1/transactions/1');
		expect(txns).toHaveLength(0);
		expect(stateRepo.markUp).not.toHaveBeenCalled();
		expect(stateRepo.markDown).not.toHaveBeenCalled();
	});

	test('first failed push marks the bridge down, keeps the row, and starts one recoverer', async () => {
		respondStatus = 500;

		await service.sendTransaction(appservice, [makeEvent('$e1')]);

		expect(stateRepo.markDown).toHaveBeenCalledTimes(1);
		expect(txns).toHaveLength(1);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0].delayMs).toBe(2000);
	});

	test('while down, event transactions are persisted but never pushed', async () => {
		states.set(AS_ID, 'down');

		await service.sendTransaction(appservice, [makeEvent('$e1')]);
		await service.sendTransaction(appservice, [makeEvent('$e2')]);

		expect(received).toHaveLength(0);
		expect(txns).toHaveLength(2);
	});

	test('while down, an ephemeral-only batch creates no transaction and is dropped', async () => {
		states.set(AS_ID, 'down');

		await service.sendTransaction(appservice, [], [typingEdu]);

		expect(received).toHaveLength(0);
		expect(txns).toHaveLength(0);
		expect(stateRepo.incrementTxnId).not.toHaveBeenCalled();
	});

	test('recoverer drains the backlog oldest-first, then marks up and stops', async () => {
		respondStatus = 500;
		await service.sendTransaction(appservice, [makeEvent('$e1')]);
		states.set(AS_ID, 'down');
		await service.sendTransaction(appservice, [makeEvent('$e2')]);

		expect(txns).toHaveLength(2);
		received = [];

		respondStatus = 200;
		scheduled[0].cb();
		await waitUntil(() => states.get(AS_ID) === 'up');

		expect(received.map((r) => r.path)).toEqual(['/_matrix/app/v1/transactions/1', '/_matrix/app/v1/transactions/2']);
		expect(txns).toHaveLength(0);
		expect(stateRepo.markUp).toHaveBeenCalledTimes(1);

		// Recovery complete — live delivery resumes.
		await service.sendTransaction(appservice, [makeEvent('$e3')]);
		expect(received).toHaveLength(3);
		expect(txns).toHaveLength(0);
	});

	test('backoff doubles per failure and caps at 2^9 seconds', async () => {
		respondStatus = 500;
		await service.sendTransaction(appservice, [makeEvent('$e1')]);

		const delays = [scheduled[0].delayMs];
		for (let i = 0; i < 10; i++) {
			const previousCount = scheduled.length;
			scheduled[scheduled.length - 1].cb();
			// eslint-disable-next-line no-await-in-loop
			await waitUntil(() => scheduled.length > previousCount);
			delays.push(scheduled[scheduled.length - 1].delayMs);
		}

		expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 512000, 512000]);
	});

	test('forceRetry cancels the backoff wait and drains immediately; no-op when up', async () => {
		await service.forceRetry(AS_ID); // no recoverer — nothing happens
		expect(received).toHaveLength(0);

		respondStatus = 500;
		await service.sendTransaction(appservice, [makeEvent('$e1')]);
		expect(scheduled).toHaveLength(1);
		received = [];

		respondStatus = 200;
		await service.forceRetry(AS_ID);
		await waitUntil(() => states.get(AS_ID) === 'up');

		expect(received.map((r) => r.path)).toEqual(['/_matrix/app/v1/transactions/1']);
		expect(txns).toHaveLength(0);
	});

	test('concurrent failures start only one recoverer and mark down once', async () => {
		respondStatus = 500;

		await Promise.all([service.sendTransaction(appservice, [makeEvent('$e1')]), service.sendTransaction(appservice, [makeEvent('$e2')])]);

		expect(stateRepo.markDown).toHaveBeenCalledTimes(1);
		expect(scheduled).toHaveLength(1);
	});

	test('retry never resends ephemeral events', async () => {
		respondStatus = 500;
		await service.sendTransaction(appservice, [makeEvent('$e1')], [typingEdu]);

		expect(received[0].body).toContainKey('ephemeral');
		received = [];

		respondStatus = 200;
		scheduled[0].cb();
		await waitUntil(() => states.get(AS_ID) === 'up');

		expect(received).toHaveLength(1);
		expect(received[0].body).not.toContainKey('ephemeral');
		expect(received[0].body).not.toContainKey('de.sorunome.msc2409.ephemeral');
		expect(received[0].body.events).toEqual([{ event_id: '$e1', type: 'm.room.message' }]);
	});

	test('a resolver failure advances backoff without deleting the row or sending a partial payload', async () => {
		respondStatus = 500;
		await service.sendTransaction(appservice, [makeEvent('$e1')]);
		received = [];

		service.setEventResolver(async () => {
			throw new Error('event gone');
		});

		respondStatus = 200;
		scheduled[0].cb();
		await waitUntil(() => scheduled.length > 1);

		expect(received).toHaveLength(0);
		expect(txns).toHaveLength(1);
		expect(scheduled[1].delayMs).toBe(4000);
		expect(states.get(AS_ID)).toBe('down');
	});

	test('startRecoverersForDownServices resumes recovery for bridges persisted as down', async () => {
		states.set(AS_ID, 'down');
		txns.push({ _id: `${AS_ID}:1`, asId: AS_ID, txnId: 1, eventIds: ['$e1'], createdAt: new Date() });

		await service.startRecoverersForDownServices([appservice]);

		expect(stateRepo.markDown).not.toHaveBeenCalled();
		expect(scheduled).toHaveLength(1);

		scheduled[0].cb();
		await waitUntil(() => states.get(AS_ID) === 'up');
		expect(txns).toHaveLength(0);
	});

	test('startRecoverersForDownServices leaves bridges persisted as up alone', async () => {
		await service.startRecoverersForDownServices([appservice]);

		expect(scheduled).toHaveLength(0);
		expect(stateRepo.markUp).not.toHaveBeenCalled();
	});
});
