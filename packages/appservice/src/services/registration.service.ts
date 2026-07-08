import { createLogger } from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';

import { APPSERVICE_CONFIG_PROVIDER, type AppServiceConfigProvider } from '../config-provider';
import type { AppServiceRegistration, CachedAppService, CompiledNamespace } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';

/**
 * XMPP is the only supported bridge. Its registration is built entirely from
 * `ConfigService` (URL + tokens); the remaining fields are fixed constants
 * derived from the `_xmpp_` prefix used throughout the codebase.
 */
const XMPP_APPSERVICE_ID = 'xmpp';
const XMPP_SENDER_LOCALPART = 'xmpp';

@singleton()
export class RegistrationService {
	private readonly logger = createLogger('RegistrationService');

	private cache: Map<string, CachedAppService> = new Map();

	private tokenIndex: Map<string, string> = new Map(); // asToken -> asId

	constructor(
		@inject(delay(() => AppServiceStateRepository))
		private readonly stateRepo: AppServiceStateRepository,
		@inject(delay(() => AppServiceTransactionRepository))
		private readonly txnRepo: AppServiceTransactionRepository,
		@inject(APPSERVICE_CONFIG_PROVIDER)
		private readonly config: AppServiceConfigProvider,
	) {}

	/**
	 * (Re)build the in-memory registration from the current config. Safe to
	 * call repeatedly — clears prior cache so a config change (e.g. a later
	 * `setConfig`) is reflected.
	 */
	async initialize(): Promise<void> {
		this.cache.clear();
		this.tokenIndex.clear();

		const { xmpp } = this.config;
		if (!xmpp) {
			// Bridge config was removed — drop persisted state and any queued
			// transactions so nothing reports or replays an appservice that is no
			// longer registered.
			await this.stateRepo.remove(XMPP_APPSERVICE_ID);
			await this.txnRepo.removeAll(XMPP_APPSERVICE_ID);
			this.logger.info({ msg: 'No bridge configured; skipping appservice registration' });
			return;
		}

		const now = new Date();
		const registration: AppServiceRegistration = {
			_id: XMPP_APPSERVICE_ID,
			url: xmpp.bridgeURL,
			asToken: xmpp.asToken,
			hsToken: xmpp.hsToken,
			senderLocalpart: XMPP_SENDER_LOCALPART,
			namespaces: {
				users: [{ regex: '@_xmpp_.*', exclusive: true }],
				aliases: [{ regex: '#_xmpp_.*', exclusive: true }],
				rooms: [],
			},
			protocols: ['xmpp'],
			rateLimited: false,
			receiveEphemeral: true,
			createdAt: now,
			updatedAt: now,
		};

		this.cacheRegistration(registration);
		await this.stateRepo.upsertState(registration._id, { state: 'up' });
		this.logger.info({ msg: `Loaded appservice registration: ${registration._id}` });
	}

	getAll(): CachedAppService[] {
		return Array.from(this.cache.values());
	}

	getById(id: string): CachedAppService | undefined {
		return this.cache.get(id);
	}

	getByAsToken(asToken: string): CachedAppService | undefined {
		const asId = this.tokenIndex.get(asToken);
		if (!asId) {
			return undefined;
		}
		return this.cache.get(asId);
	}

	async getState(asId: string) {
		return this.stateRepo.getState(asId);
	}

	private cacheRegistration(reg: AppServiceRegistration): void {
		const cached: CachedAppService = {
			registration: reg,
			compiledNamespaces: {
				users: reg.namespaces.users.map((ns) => this.compileNamespace(ns)),
				aliases: reg.namespaces.aliases.map((ns) => this.compileNamespace(ns)),
				rooms: reg.namespaces.rooms.map((ns) => this.compileNamespace(ns)),
			},
		};
		this.cache.set(reg._id, cached);
		this.tokenIndex.set(reg.asToken, reg._id);
	}

	private compileNamespace(ns: { regex: string; exclusive: boolean }): CompiledNamespace {
		return {
			regex: new RegExp(`^(?:${ns.regex})$`),
			exclusive: ns.exclusive,
		};
	}
}
