import 'reflect-metadata';

import { beforeEach, describe, expect, test } from 'bun:test';

import { RegistrationService } from './registration.service';
import type { AppServiceRegistration } from '../models/appservice.model';
import type { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import type { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';

function makeRegistration(overrides: Partial<AppServiceRegistration> = {}): AppServiceRegistration {
	return {
		_id: 'xmpp',
		url: 'http://bridge.local',
		asToken: 'as-token',
		hsToken: 'hs-token',
		senderLocalpart: 'xmpp',
		namespaces: {
			users: [{ regex: '@_xmpp_.*', exclusive: true }],
			aliases: [{ regex: '#_xmpp_.*', exclusive: true }],
			rooms: [],
		},
		protocols: ['xmpp'],
		rateLimited: false,
		receiveEphemeral: true,
		...overrides,
	};
}

function makeService() {
	const ensureStateCalls: string[] = [];
	const removeStateCalls: string[] = [];
	const removeAllTxnCalls: string[] = [];

	const stateRepo = {
		ensureState: async (id: string) => {
			ensureStateCalls.push(id);
		},
		remove: async (id: string) => {
			removeStateCalls.push(id);
		},
	} as unknown as AppServiceStateRepository;

	const txnRepo = {
		removeAll: async (id: string) => {
			removeAllTxnCalls.push(id);
		},
	} as unknown as AppServiceTransactionRepository;

	const service = new RegistrationService(stateRepo, txnRepo);
	return { service, ensureStateCalls, removeStateCalls, removeAllTxnCalls };
}

describe('RegistrationService.register', () => {
	test('caches the registration and indexes it by id and asToken', async () => {
		const { service, ensureStateCalls } = makeService();

		const cached = await service.register(makeRegistration());

		expect(cached.registration._id).toBe('xmpp');
		expect(cached.compiledNamespaces.users[0].regex.test('@_xmpp_alice:rc.host')).toBe(true);
		expect(service.getById('xmpp')?.registration._id).toBe('xmpp');
		expect(service.getByAsToken('as-token')?.registration._id).toBe('xmpp');
		expect(ensureStateCalls).toEqual(['xmpp']);
	});

	test('rejects a token already registered to a different appservice', async () => {
		const { service } = makeService();
		await service.register(makeRegistration({ _id: 'xmpp', asToken: 'shared' }));

		await expect(service.register(makeRegistration({ _id: 'irc', asToken: 'shared' }))).rejects.toThrow(
			'asToken already registered to appservice xmpp',
		);
	});

	test('re-registering the same id with a changed token drops the stale token mapping', async () => {
		const { service } = makeService();
		await service.register(makeRegistration({ asToken: 'old-token' }));

		await service.register(makeRegistration({ asToken: 'new-token' }));

		expect(service.getByAsToken('old-token')).toBeUndefined();
		expect(service.getByAsToken('new-token')?.registration._id).toBe('xmpp');
	});
});

describe('RegistrationService.unregister', () => {
	test('removes the registration and tears down its state and queued transactions', async () => {
		const { service, removeStateCalls, removeAllTxnCalls } = makeService();
		await service.register(makeRegistration());

		const removed = await service.unregister('xmpp');

		expect(removed).toBe(true);
		expect(service.getById('xmpp')).toBeUndefined();
		expect(service.getByAsToken('as-token')).toBeUndefined();
		expect(removeStateCalls).toEqual(['xmpp']);
		expect(removeAllTxnCalls).toEqual(['xmpp']);
	});

	test('returns false and skips teardown for an unknown appservice', async () => {
		const { service, removeStateCalls, removeAllTxnCalls } = makeService();

		const removed = await service.unregister('missing');

		expect(removed).toBe(false);
		expect(removeStateCalls).toEqual([]);
		expect(removeAllTxnCalls).toEqual([]);
	});
});
