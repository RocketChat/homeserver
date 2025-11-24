import type { RoomID, UserID } from '@rocket.chat/federation-room';
import { extractDomainFromId } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { FederationEndpoints } from '../specs/federation-api';
import { ConfigService } from './config.service';
import { EventAuthorizationService } from './event-authorization.service';
import { FederationRequestService } from './federation-request.service';
import { StateService } from './state.service';

export class FederationValidationError extends Error {
	public error: string;

	constructor(
		public code: 'POLICY_DENIED' | 'CONNECTION_FAILED' | 'USER_NOT_FOUND',
		public userMessage: string,
		public httpStatus: 403 | 502 | 404,
	) {
		super(userMessage);
		this.name = 'FederationValidationError';
		this.error = `federation-${code.toLowerCase().replace(/_/g, '-')}`;
	}
}

@singleton()
export class FederationValidationService {
	constructor(
		private readonly configService: ConfigService,
		private readonly federationRequestService: FederationRequestService,
		private readonly stateService: StateService,
		private readonly eventAuthorizationService: EventAuthorizationService,
	) {}

	async validateOutboundUser(userId: UserID): Promise<void> {
		const domain = extractDomainFromId(userId);
		await this.checkDomainReachable(domain);
		await this.checkUserExists(userId, domain);
	}

	async validateOutboundInvite(userId: UserID, roomId: RoomID): Promise<void> {
		const domain = extractDomainFromId(userId);
		await this.checkRoomAcl(roomId, domain);
		await this.checkDomainReachable(domain);
		await this.checkUserExists(userId, domain);
	}

	private async checkRoomAcl(roomId: RoomID, domain: string): Promise<void> {
		try {
			const state = await this.stateService.getLatestRoomState(roomId);
			const aclEvent = state.get('m.room.server_acl:');
			if (!aclEvent || !aclEvent.isServerAclEvent()) {
				return;
			}

			const isAllowed = await this.eventAuthorizationService.checkServerAcl(
				aclEvent,
				domain,
			);
			if (!isAllowed) {
				throw new FederationValidationError(
					'POLICY_DENIED',
					"Action Blocked. The room's access control policy blocks communication with this domain.",
					403,
				);
			}
		} catch (error) {
			if (error instanceof FederationValidationError) {
				throw error;
			}
		}
	}

	private async checkDomainReachable(domain: string): Promise<void> {
		const config = this.configService.getConfig('federation');
		const timeoutMs = config.validation?.networkCheckTimeoutMs || 5000;

		try {
			const versionPromise = this.federationRequestService.get<{
				server: { name?: string; version?: string };
			}>(domain, FederationEndpoints.version);

			await this.withTimeout(versionPromise, timeoutMs);
		} catch (_error) {
			throw new FederationValidationError(
				'CONNECTION_FAILED',
				'Connection Failed. The server domain could not be reached or does not support federation.',
				502,
			);
		}
	}

	private async checkUserExists(userId: UserID, domain: string): Promise<void> {
		const config = this.configService.getConfig('federation');
		const timeoutMs = config.validation?.userCheckTimeoutMs || 10000;

		try {
			const uri = FederationEndpoints.queryProfile(userId);
			const queryParams = { user_id: userId };

			const profilePromise = this.federationRequestService.get<{
				displayname?: string;
				avatar_url?: string;
			}>(domain, uri, queryParams);

			await this.withTimeout(profilePromise, timeoutMs);
		} catch (_error) {
			throw new FederationValidationError(
				'USER_NOT_FOUND',
				'Invitation blocked. The specified user couldn’t be found on their homeserver.',
				502,
			);
		}
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<T> {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				reject(new Error(`Operation timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});

		return Promise.race([promise, timeoutPromise]);
	}
}
