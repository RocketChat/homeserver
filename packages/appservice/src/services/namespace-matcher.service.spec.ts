import 'reflect-metadata';

import { describe, expect, test } from 'bun:test';

import type { AppServiceConfigProvider } from '../config-provider';
import { NamespaceMatcherService } from './namespace-matcher.service';
import type { RegistrationService } from './registration.service';
import type { AppServiceRegistration, CachedAppService, CompiledNamespace } from '../models/appservice.model';

const SERVER_NAME = 'rc.host';

// Mirror registration.service's compilation so the regexes behave identically.
function compile(regex: string): CompiledNamespace {
	return { regex: new RegExp(`^(?:${regex})$`), exclusive: true };
}

// An xmpp-style bridge: ghosts/aliases are namespaced under `_xmpp_`, the bot
// user (@xmpp:rc.host) is NOT covered by the ghost regex.
function xmppAppService(): CachedAppService {
	return {
		registration: {
			_id: 'xmpp',
			senderLocalpart: 'xmpp',
		} as AppServiceRegistration,
		compiledNamespaces: {
			users: [compile('@_xmpp_.*')],
			aliases: [compile('#_xmpp_.*')],
			rooms: [],
		},
	} as CachedAppService;
}

// A greedy bridge whose exclusive user namespace matches every user on the
// server, including other appservices' bot users.
function greedyAppService(): CachedAppService {
	return {
		registration: {
			_id: 'greedy',
			senderLocalpart: 'greedy',
		} as AppServiceRegistration,
		compiledNamespaces: {
			users: [compile('@.*')],
			aliases: [],
			rooms: [],
		},
	} as CachedAppService;
}

function makeService(appservices: CachedAppService[]): NamespaceMatcherService {
	const registrationService = {
		getAll: () => appservices,
		getById: (id: string) => appservices.find((as) => as.registration._id === id),
	} as unknown as RegistrationService;
	const config = { serverName: SERVER_NAME } as AppServiceConfigProvider;
	return new NamespaceMatcherService(registrationService, config);
}

describe('NamespaceMatcherService.getAppServiceForUser', () => {
	test('returns the appservice for its bot user even though no namespace matches it', () => {
		const service = makeService([xmppAppService()]);

		expect(service.getAppServiceForUser('@xmpp:rc.host')?.registration._id).toBe('xmpp');
	});

	test('returns the appservice for a ghost user via the user namespace', () => {
		const service = makeService([xmppAppService()]);

		expect(service.getAppServiceForUser('@_xmpp_alice:rc.host')?.registration._id).toBe('xmpp');
	});

	test('returns undefined for an unrelated user', () => {
		const service = makeService([xmppAppService()]);

		expect(service.getAppServiceForUser('@alice:rc.host')).toBeUndefined();
	});

	test("resolves the bot user to its owner even when another appservice's namespace matches it", () => {
		const service = makeService([greedyAppService(), xmppAppService()]);

		expect(service.getAppServiceForUser('@xmpp:rc.host')?.registration._id).toBe('xmpp');
	});
});

describe('NamespaceMatcherService.isUserInNamespace', () => {
	test('matches the bot user, including when restricted to its own appservice', () => {
		const service = makeService([xmppAppService()]);

		expect(service.isUserInNamespace('@xmpp:rc.host')).toBe(true);
		expect(service.isUserInNamespace('@xmpp:rc.host', 'xmpp')).toBe(true);
		expect(service.isUserInNamespace('@xmpp:rc.host', 'other')).toBe(false);
	});
});

describe('NamespaceMatcherService.isExclusive', () => {
	test('treats the bot user as implicitly exclusive to its appservice', () => {
		const service = makeService([xmppAppService()]);

		expect(service.isExclusive('users', '@xmpp:rc.host')?.registration._id).toBe('xmpp');
	});

	test('returns the owning appservice for an exclusive ghost namespace', () => {
		const service = makeService([xmppAppService()]);

		expect(service.isExclusive('users', '@_xmpp_alice:rc.host')?.registration._id).toBe('xmpp');
	});

	test('returns undefined for an unrelated user', () => {
		const service = makeService([xmppAppService()]);

		expect(service.isExclusive('users', '@alice:rc.host')).toBeUndefined();
	});

	test("a broad exclusive namespace cannot claim another appservice's bot user", () => {
		// The greedy bridge is iterated first and its `@.*` regex matches the xmpp
		// bot user, yet the bot user must remain exclusive to xmpp.
		const service = makeService([greedyAppService(), xmppAppService()]);

		expect(service.isExclusive('users', '@xmpp:rc.host')?.registration._id).toBe('xmpp');
	});
});

describe('NamespaceMatcherService.getInterestedAppServices', () => {
	const ROOM = '!random:rc.host';

	test('is interested when the sender is the bridge bot user (section 4, bot user)', () => {
		const service = makeService([xmppAppService()]);

		// The bot user does not match the ghost regex `@_xmpp_.*`, but the bridge
		// owns its sender_localpart user implicitly.
		const interested = service.getInterestedAppServices(ROOM, '@xmpp:rc.host', [], []);

		expect(interested.map((as) => as.registration._id)).toEqual(['xmpp']);
	});

	test('is interested when the sender is a ghost (section 4, user namespace)', () => {
		const service = makeService([xmppAppService()]);

		const interested = service.getInterestedAppServices(ROOM, '@_xmpp_alice:rc.host', [], []);

		expect(interested.map((as) => as.registration._id)).toEqual(['xmpp']);
	});

	test('is interested when the bot user is a room member (section 3, bot user)', () => {
		const service = makeService([xmppAppService()]);

		// Sender is an unrelated real user; the bridge is interested because its
		// bot user is in the room.
		const interested = service.getInterestedAppServices(ROOM, '@alice:rc.host', [], ['@alice:rc.host', '@xmpp:rc.host']);

		expect(interested.map((as) => as.registration._id)).toEqual(['xmpp']);
	});

	test('is interested when a ghost is a room member (section 3, user namespace)', () => {
		const service = makeService([xmppAppService()]);

		const interested = service.getInterestedAppServices(ROOM, '@alice:rc.host', [], ['@alice:rc.host', '@_xmpp_bob:rc.host']);

		expect(interested.map((as) => as.registration._id)).toEqual(['xmpp']);
	});

	test('is not interested when neither the sender nor any member belongs to the bridge', () => {
		const service = makeService([xmppAppService()]);

		const interested = service.getInterestedAppServices(ROOM, '@alice:rc.host', [], ['@alice:rc.host', '@bob:rc.host']);

		expect(interested).toEqual([]);
	});

	test('is interested via a matching room alias (section 2)', () => {
		const service = makeService([xmppAppService()]);

		const interested = service.getInterestedAppServices(ROOM, '@alice:rc.host', ['#_xmpp_general:rc.host'], []);

		expect(interested.map((as) => as.registration._id)).toEqual(['xmpp']);
	});

	test("another appservice's bot user still matches this bridge's namespace (non-exclusive overlap)", () => {
		const service = makeService([greedyAppService(), xmppAppService()]);

		// xmpp owns its bot user, but greedy's `@.*` namespace also matches it —
		// ownership by one bridge must not suppress another's namespace interest.
		const interested = service.getInterestedAppServices(ROOM, '@alice:rc.host', [], ['@xmpp:rc.host']);

		expect(interested.map((as) => as.registration._id).sort()).toEqual(['greedy', 'xmpp']);
	});

	test('returns each interested appservice once even when several rules match', () => {
		const service = makeService([xmppAppService()]);

		// Bot user is both the sender (rule 4) and a member (rule 3).
		const interested = service.getInterestedAppServices(ROOM, '@xmpp:rc.host', [], ['@xmpp:rc.host']);

		expect(interested).toHaveLength(1);
	});
});
