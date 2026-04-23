import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { BridgeQueryService } from './bridge-query.service';
import { NamespaceMatcherService } from './namespace-matcher.service';
import { RegistrationService } from './registration.service';

/**
 * Handles namespace enforcement and lazy-loading of bridged resources.
 *
 * Namespace enforcement: prevents non-owning clients from registering users
 * or creating aliases in exclusive namespaces.
 *
 * Lazy loading: when an unknown user or alias is queried that matches a
 * bridge namespace, queries the bridge to create the resource on-demand.
 */
@singleton()
export class NamespaceGuardService {
	private readonly logger = createLogger('NamespaceGuardService');

	constructor(
		private readonly namespaceMatcher: NamespaceMatcherService,
		private readonly bridgeQuery: BridgeQueryService,
		private readonly registrationService: RegistrationService,
	) {}

	/**
	 * Check if a username can be registered by a non-appservice client.
	 * Returns an error object if blocked, undefined if allowed.
	 */
	checkUserRegistration(userId: string, requestingAsId?: string): { errcode: string; error: string } | undefined {
		const exclusiveOwner = this.namespaceMatcher.isExclusive('users', userId);
		if (!exclusiveOwner) return undefined;

		if (requestingAsId && exclusiveOwner.registration._id === requestingAsId) {
			return undefined; // Owning appservice is allowed
		}

		return {
			errcode: 'M_EXCLUSIVE',
			error: `User ID ${userId} is within the exclusive namespace of appservice ${exclusiveOwner.registration._id}`,
		};
	}

	/**
	 * Check if a room alias can be created by a non-appservice client.
	 */
	checkAliasCreation(alias: string, requestingAsId?: string): { errcode: string; error: string } | undefined {
		const exclusiveOwner = this.namespaceMatcher.isExclusive('aliases', alias);
		if (!exclusiveOwner) return undefined;

		if (requestingAsId && exclusiveOwner.registration._id === requestingAsId) {
			return undefined;
		}

		return {
			errcode: 'M_EXCLUSIVE',
			error: `Alias ${alias} is within the exclusive namespace of appservice ${exclusiveOwner.registration._id}`,
		};
	}

	/**
	 * Attempt to lazy-create a user via bridge query.
	 * Called when a user ID matches a bridge namespace but doesn't exist locally.
	 * Returns true if a bridge claimed the user (bridge will register it).
	 */
	async lazyCreateUser(userId: string): Promise<boolean> {
		const owningAs = this.namespaceMatcher.getAppServiceForUser(userId);
		if (!owningAs) return false;

		this.logger.info({
			msg: 'Querying bridge for unknown user',
			userId,
			asId: owningAs.registration._id,
		});

		const claimed = await this.bridgeQuery.queryUser(owningAs.registration._id, userId);

		if (claimed) {
			this.logger.info({
				msg: 'Bridge claimed user, waiting for registration',
				userId,
				asId: owningAs.registration._id,
			});
		}

		return claimed;
	}

	/**
	 * Attempt to lazy-create a room alias via bridge query.
	 * Called when an alias matches a bridge namespace but doesn't exist locally.
	 * Returns true if a bridge claimed the alias (bridge will create the room).
	 */
	async lazyCreateRoomAlias(roomAlias: string): Promise<boolean> {
		const owningAs = this.namespaceMatcher.matches('aliases', roomAlias);
		if (!owningAs) return false;

		this.logger.info({
			msg: 'Querying bridge for unknown room alias',
			roomAlias,
			asId: owningAs.registration._id,
		});

		const claimed = await this.bridgeQuery.queryRoomAlias(owningAs.registration._id, roomAlias);

		if (claimed) {
			this.logger.info({
				msg: 'Bridge claimed room alias, waiting for creation',
				roomAlias,
				asId: owningAs.registration._id,
			});
		}

		return claimed;
	}
}
