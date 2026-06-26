import { inject, singleton } from 'tsyringe';

import { RegistrationService } from './registration.service';
import { APPSERVICE_CONFIG_PROVIDER, type AppServiceConfigProvider } from '../config-provider';
import type { CachedAppService } from '../models/appservice.model';

type NamespaceType = 'users' | 'aliases' | 'rooms';

@singleton()
export class NamespaceMatcherService {
	constructor(
		private readonly registrationService: RegistrationService,
		@inject(APPSERVICE_CONFIG_PROVIDER) private readonly config: AppServiceConfigProvider,
	) {}

	/**
	 * Check if a value matches any appservice's namespace of the given type.
	 * Optionally restrict to a specific appservice.
	 */
	matches(type: NamespaceType, value: string, asId?: string): CachedAppService | undefined {
		const appservices = asId
			? ([this.registrationService.getById(asId)].filter(Boolean) as CachedAppService[])
			: this.registrationService.getAll();

		for (const as of appservices) {
			for (const ns of as.compiledNamespaces[type]) {
				if (ns.regex.test(value)) {
					return as;
				}
			}
		}
		return undefined;
	}

	/**
	 * Check if a value falls within an exclusive namespace.
	 * Returns the owning appservice if exclusive, undefined otherwise.
	 */
	isExclusive(type: NamespaceType, value: string): CachedAppService | undefined {
		for (const as of this.registrationService.getAll()) {
			for (const ns of as.compiledNamespaces[type]) {
				if (ns.exclusive && ns.regex.test(value)) {
					return as;
				}
			}
		}
		return undefined;
	}

	isUserInNamespace(userId: string, asId?: string): boolean {
		return this.matches('users', userId, asId) !== undefined;
	}

	isAliasInNamespace(alias: string, asId?: string): boolean {
		return this.matches('aliases', alias, asId) !== undefined;
	}

	isRoomInNamespace(roomId: string, asId?: string): boolean {
		return this.matches('rooms', roomId, asId) !== undefined;
	}

	/**
	 * Get which appservice owns a user (if any).
	 */
	getAppServiceForUser(userId: string): CachedAppService | undefined {
		return this.matches('users', userId);
	}

	/**
	 * Whether an appservice is interested in a user. An appservice is interested
	 * in a user if it is the appservice's own sender_localpart (bot) user — which
	 * it owns implicitly, regardless of namespaces — or if the user matches one
	 * of the appservice's user namespaces.
	 */
	private isInterestedInUser(as: CachedAppService, userId: string): boolean {
		const asUserId = `@${as.registration.senderLocalpart}:${this.config.serverName}`;
		if (userId === asUserId) {
			return true;
		}
		return as.compiledNamespaces.users.some((ns) => ns.regex.test(userId));
	}

	/**
	 * Determine which appservices are interested in an event.
	 *
	 * A bridge is interested if any of the following match:
	 * 1. Room ID matches the bridge's room namespace
	 * 2. Any room alias matches the bridge's alias namespace
	 * 3. Any room member belongs to the bridge (bot user or user namespace)
	 * 4. The event sender belongs to the bridge (bot user or user namespace)
	 */
	getInterestedAppServices(roomId: string, sender: string, roomAliases: string[], roomMembers: string[]): CachedAppService[] {
		const interested = new Map<string, CachedAppService>();

		for (const as of this.registrationService.getAll()) {
			if (interested.has(as.registration._id)) continue;

			// 1. Room ID matches room namespace
			for (const ns of as.compiledNamespaces.rooms) {
				if (ns.regex.test(roomId)) {
					interested.set(as.registration._id, as);
					break;
				}
			}
			if (interested.has(as.registration._id)) continue;

			// 2. Any room alias matches alias namespace
			for (const alias of roomAliases) {
				let found = false;
				for (const ns of as.compiledNamespaces.aliases) {
					if (ns.regex.test(alias)) {
						interested.set(as.registration._id, as);
						found = true;
						break;
					}
				}
				if (found) break;
			}
			if (interested.has(as.registration._id)) continue;

			// 3. Any room member belongs to the appservice
			for (const member of roomMembers) {
				if (this.isInterestedInUser(as, member)) {
					interested.set(as.registration._id, as);
					break;
				}
			}
			if (interested.has(as.registration._id)) continue;

			// 4. Event sender belongs to the appservice
			if (this.isInterestedInUser(as, sender)) {
				interested.set(as.registration._id, as);
			}
		}

		return Array.from(interested.values());
	}
}
