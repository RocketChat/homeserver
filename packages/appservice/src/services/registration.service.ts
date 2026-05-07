import * as fs from 'node:fs';
import * as path from 'node:path';

import { createLogger } from '@rocket.chat/federation-core';
import { delay, inject, singleton } from 'tsyringe';
import YAML from 'yaml';

import type { AppServiceRegistration, AppServiceRegistrationYaml, CachedAppService, CompiledNamespace } from '../models/appservice.model';
import { AppServiceStateRepository } from '../repositories/appservice-state.repository';
import { AppServiceRepository } from '../repositories/appservice.repository';

@singleton()
export class RegistrationService {
	private readonly logger = createLogger('RegistrationService');

	private cache: Map<string, CachedAppService> = new Map();

	private tokenIndex: Map<string, string> = new Map(); // asToken -> asId

	constructor(
		@inject(delay(() => AppServiceRepository))
		private readonly appServiceRepo: AppServiceRepository,
		@inject(delay(() => AppServiceStateRepository))
		private readonly stateRepo: AppServiceStateRepository,
	) {}

	async initialize(): Promise<void> {
		const registrations = await this.appServiceRepo.findAll();
		for (const reg of registrations) {
			this.cacheRegistration(reg);
		}
		this.logger.info({ msg: `Loaded ${registrations.length} appservice registrations` });
	}

	async loadFromYaml(filePath: string): Promise<AppServiceRegistration> {
		const content = fs.readFileSync(filePath, 'utf-8');
		const yaml = YAML.parse(content) as AppServiceRegistrationYaml;
		return this.registerFromYaml(yaml);
	}

	/**
	 * Reload all YAML-source registrations from a directory. Existing
	 * registrations marked `source: 'yaml'` that no longer have a matching
	 * file are removed (matches Synapse semantics where the YAML files are
	 * the source of truth). API-source registrations are left untouched.
	 */
	async loadAllFromDirectory(dirPath: string): Promise<number> {
		if (!fs.existsSync(dirPath)) {
			this.logger.warn({ msg: `Appservice config directory not found: ${dirPath}` });
			return 0;
		}

		const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

		let loaded = 0;
		const results = await Promise.allSettled(files.map((file) => this.loadFromYaml(path.join(dirPath, file))));
		for (let i = 0; i < results.length; i++) {
			if (results[i].status === 'fulfilled') {
				loaded++;
			} else {
				this.logger.error({
					msg: `Failed to load appservice registration from ${files[i]}`,
					err: (results[i] as PromiseRejectedResult).reason,
				});
			}
		}

		this.logger.info({
			msg: `Loaded ${loaded} appservice registrations from ${dirPath}`,
		});
		return loaded;
	}

	async registerFromYaml(yaml: AppServiceRegistrationYaml): Promise<AppServiceRegistration> {
		const registration = this.yamlToRegistration(yaml);
		return this.register(registration);
	}

	async register(registration: AppServiceRegistration): Promise<AppServiceRegistration> {
		this.validateRegistration(registration);

		await this.appServiceRepo.upsert(registration);

		await this.stateRepo.upsertState(registration._id, {
			state: 'up',
		});

		this.cacheRegistration(registration);
		this.logger.info({ msg: `Registered appservice: ${registration._id} (source: ${registration.source})` });

		return registration;
	}

	async unregister(id: string): Promise<boolean> {
		const removed = await this.appServiceRepo.remove(id);
		if (removed) {
			await this.stateRepo.remove(id);
			this.evictFromCache(id);
			this.logger.info({ msg: `Unregistered appservice: ${id}` });
		}
		return removed;
	}

	private evictFromCache(id: string): void {
		const cached = this.cache.get(id);
		if (cached) {
			this.tokenIndex.delete(cached.registration.asToken);
		}
		this.cache.delete(id);
	}

	getAll(): CachedAppService[] {
		return Array.from(this.cache.values());
	}

	getById(id: string): CachedAppService | undefined {
		return this.cache.get(id);
	}

	getByAsToken(asToken: string): CachedAppService | undefined {
		const asId = this.tokenIndex.get(asToken);
		if (!asId) return undefined;
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
			regex: new RegExp(ns.regex),
			exclusive: ns.exclusive,
		};
	}

	private validateRegistration(reg: AppServiceRegistration): void {
		if (!reg._id) throw new Error('Registration id is required');
		if (!reg.asToken) throw new Error('as_token is required');
		if (!reg.hsToken) throw new Error('hs_token is required');
		if (!reg.senderLocalpart) throw new Error('sender_localpart is required');

		// Check for token conflicts with other registrations
		const existingByToken = this.tokenIndex.get(reg.asToken);
		if (existingByToken && existingByToken !== reg._id) {
			throw new Error(`as_token conflict: token already used by appservice ${existingByToken}`);
		}

		// Validate namespace regexes compile
		const allNamespaces = [...reg.namespaces.users, ...reg.namespaces.aliases, ...reg.namespaces.rooms];
		for (const ns of allNamespaces) {
			try {
				new RegExp(ns.regex);
			} catch {
				throw new Error(`Invalid namespace regex: ${ns.regex}`);
			}
		}
	}

	private yamlToRegistration(yaml: AppServiceRegistrationYaml): AppServiceRegistration {
		const now = new Date();
		return {
			_id: yaml.id,
			url: yaml.url ?? null,
			asToken: yaml.as_token,
			hsToken: yaml.hs_token,
			senderLocalpart: yaml.sender_localpart,
			namespaces: {
				users: (yaml.namespaces?.users ?? []).map((ns) => ({
					regex: ns.regex,
					exclusive: ns.exclusive ?? false,
				})),
				aliases: (yaml.namespaces?.aliases ?? []).map((ns) => ({
					regex: ns.regex,
					exclusive: ns.exclusive ?? false,
				})),
				rooms: (yaml.namespaces?.rooms ?? []).map((ns) => ({
					regex: ns.regex,
					exclusive: ns.exclusive ?? false,
				})),
			},
			protocols: yaml.protocols ?? [],
			rateLimited: yaml.rate_limited ?? true,
			receiveEphemeral: yaml['de.sorunome.msc2409.push_ephemeral'] ?? false,
			source: 'yaml',
			createdAt: now,
			updatedAt: now,
		};
	}
}
