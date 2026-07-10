import 'reflect-metadata';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { PersistentEventBase } from '@rocket.chat/federation-room';

import { EventRouterService, MAX_PERSISTENT_EVENTS_PER_TXN } from './event-router.service';
import type { NamespaceMatcherService } from './namespace-matcher.service';
import type { TransactionSenderService } from './transaction-sender.service';
import type { CachedAppService } from '../models/appservice.model';

// Flushes a batch synchronously: afterAppend() flushes once events reach
// MAX_PERSISTENT_EVENTS_PER_TXN, so no fake timers are needed.

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void };

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const fakeAppService = { registration: { _id: 'xmpp', receiveEphemeral: true } } as unknown as CachedAppService;

function makeEvent(tag: string): PersistentEventBase {
	return { roomId: '!r:s', sender: '@u:s', eventId: tag, event: {} } as unknown as PersistentEventBase;
}

// Routes a full batch tagged so the first event's id identifies which batch a
// sendTransaction call corresponds to.
async function routeBatch(router: EventRouterService, tag: string): Promise<void> {
	for (let i = 0; i < MAX_PERSISTENT_EVENTS_PER_TXN; i++) {
		// eslint-disable-next-line no-await-in-loop
		await router.routePersistent(makeEvent(`${tag}:${i}`));
	}
}

describe('EventRouterService send serialization', () => {
	let router: EventRouterService;
	let sends: Array<{ asId: string; tag: string; deferred: Deferred<void> }>;
	let sendTransaction: ReturnType<typeof mock>;

	beforeEach(() => {
		sends = [];
		// Each call records the target appservice and batch tag (first event's id
		// prefix) and returns a promise we resolve/reject manually, so we control
		// ordering precisely.
		sendTransaction = mock((as: CachedAppService, events: PersistentEventBase[]) => {
			const tag = events[0]?.eventId.split(':')[0] ?? '';
			const d = deferred<void>();
			sends.push({ asId: as.registration._id, tag, deferred: d });
			return d.promise;
		});

		const namespaceMatcher = {
			getInterestedAppServices: () => [fakeAppService],
		} as unknown as NamespaceMatcherService;

		const transactionSender = { sendTransaction } as unknown as TransactionSenderService;

		router = new EventRouterService(namespaceMatcher, transactionSender);
	});

	test('does not start the next batch until the previous send resolves', async () => {
		await routeBatch(router, 'a');
		await tick();

		// First batch sent; second not yet attempted.
		expect(sendTransaction).toHaveBeenCalledTimes(1);
		expect(sends[0].tag).toBe('a');

		await routeBatch(router, 'b');
		await tick();

		// Still only one send in flight — the chain is blocked on batch 'a'.
		expect(sendTransaction).toHaveBeenCalledTimes(1);

		// Resolve 'a' → 'b' is now free to go.
		sends[0].deferred.resolve();
		await tick();

		expect(sendTransaction).toHaveBeenCalledTimes(2);
		expect(sends.map((s) => s.tag)).toEqual(['a', 'b']);
	});

	test('a failed send does not break the chain for subsequent batches', async () => {
		await routeBatch(router, 'a');
		await tick();
		await routeBatch(router, 'b');
		await tick();

		expect(sendTransaction).toHaveBeenCalledTimes(1);

		// First send rejects — the chain must swallow it and continue.
		sends[0].deferred.reject(new Error('bridge down'));
		await tick();

		expect(sendTransaction).toHaveBeenCalledTimes(2);
		expect(sends[1].tag).toBe('b');

		sends[1].deferred.resolve();
		await tick();
	});

	test('a slow bridge does not block another (no cross-bridge head-of-line blocking)', async () => {
		const asA = { registration: { _id: 'aaa', receiveEphemeral: true } } as unknown as CachedAppService;
		const asB = { registration: { _id: 'bbb', receiveEphemeral: true } } as unknown as CachedAppService;

		const matcher = { getInterestedAppServices: () => [asA, asB] } as unknown as NamespaceMatcherService;
		router = new EventRouterService(matcher, { sendTransaction } as unknown as TransactionSenderService);

		// First batch goes to both bridges; neither send is resolved yet.
		await routeBatch(router, 'x');
		await tick();
		expect(sendTransaction).toHaveBeenCalledTimes(2);

		// Second batch also goes to both. Each bridge's second send is queued
		// behind its own (still-pending) first send.
		await routeBatch(router, 'y');
		await tick();
		expect(sendTransaction).toHaveBeenCalledTimes(2);

		// Resolve ONLY bridge A's first send. A's chain advances to its second
		// batch; B stays blocked on its own still-pending first send.
		const aFirst = sends.find((s) => s.asId === 'aaa' && s.tag === 'x');
		aFirst?.deferred.resolve();
		await tick();

		expect(sendTransaction).toHaveBeenCalledTimes(3);
		const aTags = sends.filter((s) => s.asId === 'aaa').map((s) => s.tag);
		const bTags = sends.filter((s) => s.asId === 'bbb').map((s) => s.tag);
		expect(aTags).toEqual(['x', 'y']); // A serialized its own batches, in order
		expect(bTags).toEqual(['x']); // B not dragged along by A
	});
});
