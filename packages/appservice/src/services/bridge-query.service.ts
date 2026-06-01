import { createLogger, fetch } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';

import { RegistrationService } from './registration.service';
import type { CachedAppService } from '../models/appservice.model';

@singleton()
export class BridgeQueryService {
	private readonly logger = createLogger('BridgeQueryService');

	constructor(private readonly registrationService: RegistrationService) {}

	/**
	 * Query a bridge about an unknown user in its namespace.
	 * Returns true if the bridge claims the user (200), false otherwise.
	 */
	async queryUser(asId: string, userId: string): Promise<boolean> {
		const as = this.registrationService.getById(asId);
		if (!as?.registration.url) return false;

		return this.queryBridge(as, `/_matrix/app/v1/users/${encodeURIComponent(userId)}`);
	}

	/**
	 * Query a bridge about an unknown room alias in its namespace.
	 * Returns true if the bridge claims the alias (200), false otherwise.
	 */
	async queryRoomAlias(asId: string, roomAlias: string): Promise<any> {
		const as = this.registrationService.getById(asId);
		if (!as?.registration.url) return false;

		return this.queryBridge(as, `/_matrix/app/v1/rooms/${encodeURIComponent(roomAlias)}`);
	}

	/**
	 * Get third-party protocol metadata from a bridge.
	 */
	async queryThirdPartyProtocol(asId: string, protocol: string): Promise<Record<string, unknown> | null> {
		const as = this.registrationService.getById(asId);
		if (!as?.registration.url) return null;

		return this.queryBridgeJson(as, `/_matrix/app/v1/thirdparty/protocol/${encodeURIComponent(protocol)}`);
	}

	/**
	 * Query third-party users from a bridge.
	 */
	async queryThirdPartyUser(asId: string, protocol: string, fields: Record<string, string>): Promise<Record<string, unknown>[] | null> {
		const as = this.registrationService.getById(asId);
		if (!as?.registration.url) return null;

		const params = new URLSearchParams(fields).toString();
		const path = protocol
			? `/_matrix/app/v1/thirdparty/user/${encodeURIComponent(protocol)}?${params}`
			: `/_matrix/app/v1/thirdparty/user?${params}`;

		return this.queryBridgeJson(as, path) as Promise<Record<string, unknown>[] | null>;
	}

	/**
	 * Query third-party locations from a bridge.
	 */
	async queryThirdPartyLocation(asId: string, protocol: string, fields: Record<string, string>): Promise<Record<string, unknown>[] | null> {
		const as = this.registrationService.getById(asId);
		if (!as?.registration.url) return null;

		const params = new URLSearchParams(fields).toString();
		const path = protocol
			? `/_matrix/app/v1/thirdparty/location/${encodeURIComponent(protocol)}?${params}`
			: `/_matrix/app/v1/thirdparty/location?${params}`;

		return this.queryBridgeJson(as, path) as Promise<Record<string, unknown>[] | null>;
	}

	/**
	 * Aggregate all third-party protocols from all registered bridges.
	 */
	async getAllProtocols(): Promise<Record<string, unknown>> {
		const result: Record<string, unknown> = {};

		const queries = this.registrationService.getAll().flatMap((as) =>
			as.registration.protocols.map(async (protocol) => {
				const data = await this.queryThirdPartyProtocol(as.registration._id, protocol);
				if (data) {
					result[protocol] = data;
				}
			}),
		);
		await Promise.all(queries);

		return result;
	}

	private async queryBridge(as: CachedAppService, path: string): Promise<any> {
		try {
			const url = new URL(`${as.registration.url}${path}`);

			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${as.registration.hsToken}`,
					Host: url.host,
				},
			});

			return response;
		} catch (err) {
			this.logger.error({
				msg: 'Bridge query failed',
				asId: as.registration._id,
				path,
				err,
			});
			return false;
		}
	}

	private async queryBridgeJson(as: CachedAppService, path: string): Promise<Record<string, unknown> | null> {
		try {
			const response = await fetch(new URL(`${as.registration.url}${path}`), {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${as.registration.hsToken}`,
				},
			});

			if (!response.ok) return null;
			return response.json() as Promise<Record<string, unknown>>;
		} catch (err) {
			this.logger.error({
				msg: 'Bridge query failed',
				asId: as.registration._id,
				path,
				err,
			});
			return null;
		}
	}
}
