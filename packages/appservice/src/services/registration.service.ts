import { createLogger } from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';

import type { AppServiceRegistration, CachedAppService, CompiledNamespace } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceTransactionRepository } from '../repositories/appservice-txn.repository';

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
	) {}

	/**
	 * Add or update an appservice registration in the in-memory cache. Re-registering
	 * the same `_id` overwrites the previous entry (used for updates that change the
	 * token or namespaces).
	 */
	async register(reg: AppServiceRegistration): Promise<CachedAppService> {
		const tokenOwner = this.tokenIndex.get(reg.asToken);
		if (tokenOwner && tokenOwner !== reg._id) {
			throw new Error(`asToken already registered to appservice ${tokenOwner}`);
		}

		// Drop the previous token→id mapping so a changed token doesn't leave a stale entry.
		const existing = this.cache.get(reg._id);
		if (existing) {
			this.tokenIndex.delete(existing.registration.asToken);
		}

		this.cacheRegistration(reg);
		// Insert-only: a bridge persisted as `down` must keep that state across
		// boots so its recoverer resumes instead of being reset to `up`.
		await this.stateRepo.ensureState(reg._id);
		this.logger.info({ msg: `Registered appservice: ${reg._id}` });

		return this.cache.get(reg._id) as CachedAppService;
	}

	/**
	 * Remove an appservice registration and drop its persisted state and any queued
	 * transactions so nothing reports or replays an appservice that is no longer
	 * registered. Returns whether the registration existed.
	 */
	async unregister(id: string): Promise<boolean> {
		const existing = this.cache.get(id);
		if (!existing) {
			return false;
		}

		this.cache.delete(id);
		this.tokenIndex.delete(existing.registration.asToken);
		await this.stateRepo.remove(id);
		await this.txnRepo.removeAll(id);
		this.logger.info({ msg: `Unregistered appservice: ${id}` });

		return true;
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
