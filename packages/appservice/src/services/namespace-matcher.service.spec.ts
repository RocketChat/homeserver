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

function makeService(appservices: CachedAppService[]): NamespaceMatcherService {
	const registrationService = {
		getAll: () => appservices,
		getById: (id: string) => appservices.find((as) => as.registration._id === id),
	} as unknown as RegistrationService;
	const config = { serverName: SERVER_NAME } as AppServiceConfigProvider;
	return new NamespaceMatcherService(registrationService, config);
}

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

	test('returns each interested appservice once even when several rules match', () => {
		const service = makeService([xmppAppService()]);

		// Bot user is both the sender (rule 4) and a member (rule 3).
		const interested = service.getInterestedAppServices(ROOM, '@xmpp:rc.host', [], ['@xmpp:rc.host']);

		expect(interested).toHaveLength(1);
	});
});
