import type { EventBase } from '@hs/core';
import type { ProtocolVersionKey } from '@hs/core';
import { createLogger } from '@hs/core';
import { PersistentEventBase } from '@hs/room';
import { inject, singleton } from 'tsyringe';
import {
	FederationEndpoints,
	type MakeJoinResponse,
	type SendJoinResponse,
	type SendTransactionResponse,
	type Transaction,
	type Version,
} from '../specs/federation-api';
import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';
import { SignatureVerificationService } from './signature-verification.service';
import { StateService } from './state.service';

@singleton()
export class FederationService {
	private readonly logger = createLogger('FederationService');

	constructor(
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject('FederationRequestService')
		private readonly requestService: FederationRequestService,
		@inject('SignatureVerificationService')
		private readonly signatureService: SignatureVerificationService,
		private readonly stateService: StateService,
	) {}

	/**
	 * Get a make_join template for a room and user
	 */
	async makeJoin(
		domain: string,
		roomId: string,
		userId: string,
		version?: string,
	): Promise<MakeJoinResponse> {
		try {
			const uri = FederationEndpoints.makeJoin(roomId, userId);
			const queryParams: Record<string, string> = {};

			if (version) {
				queryParams.ver = version;
			} else {
				// 3-11 is what we support now
				// FIXME: this is wrong, for now just passing 10 to check if supported, we need ver=1&ver=2 and so on.
				for (let ver = 3; ver <= 11; ver++) {
					queryParams[`ver${ver === 1 ? '' : ver}`] = ver.toString();
				}
			}

			return await this.requestService.get<MakeJoinResponse>(
				domain,
				uri,
				queryParams,
			);
		} catch (error: any) {
			this.logger.error(`makeJoin failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Send a join event to a remote server
	 */
	async sendJoin(
		joinEvent: PersistentEventBase,
		omitMembers = false,
	): Promise<SendJoinResponse> {
		try {
			const event = joinEvent.event;

			const uri = FederationEndpoints.sendJoinV2(
				joinEvent.roomId,
				joinEvent.eventId,
			);
			const queryParams = omitMembers ? { omit_members: 'true' } : undefined;

			const residentServer = joinEvent.roomId.split(':').pop();

			if (!residentServer) {
				this.logger.debug(joinEvent.event, 'invalid room_id');
				throw new Error(
					`invalid room_id ${joinEvent.roomId}, no server_name part`,
				);
			}

			return await this.requestService.put<SendJoinResponse>(
				residentServer,
				uri,
				event,
				queryParams,
			);
		} catch (error: any) {
			this.logger.error(`sendJoin failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Send a transaction to a remote server
	 */
	async sendTransaction(
		domain: string,
		transaction: Transaction,
	): Promise<SendTransactionResponse> {
		try {
			const txnId = Date.now().toString();
			const uri = FederationEndpoints.sendTransaction(txnId);

			return await this.requestService.put<SendTransactionResponse>(
				domain,
				uri,
				transaction,
			);
		} catch (error: any) {
			this.logger.error(
				`sendTransaction failed: ${error?.message}`,
				error?.stack,
			);
			throw error;
		}
	}

	/**
	 * Send an event to a remote server
	 */
	async sendEvent<T extends EventBase>(
		domain: string,
		event: T,
	): Promise<SendTransactionResponse> {
		try {
			const transaction: Transaction = {
				origin: this.configService.serverName,
				origin_server_ts: Date.now(),
				pdus: [event],
			};

			return await this.sendTransaction(domain, transaction);
		} catch (error: any) {
			this.logger.error(`sendEvent failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Get events from a remote server
	 */
	async getEvent(domain: string, eventId: string): Promise<EventBase> {
		try {
			const uri = FederationEndpoints.getEvent(eventId);
			return await this.requestService.get<EventBase>(domain, uri);
		} catch (error: any) {
			this.logger.error(`getEvent failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Get state for a room from remote server
	 */
	async getState(
		domain: string,
		roomId: string,
		eventId: string,
	): Promise<EventBase> {
		try {
			const uri = FederationEndpoints.getState(roomId);
			const queryParams = { event_id: eventId };

			return await this.requestService.get<EventBase>(domain, uri, queryParams);
		} catch (error: any) {
			this.logger.error(`getState failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Get state IDs for a room from remote server
	 */
	async getStateIds(domain: string, roomId: string): Promise<EventBase[]> {
		try {
			const uri = FederationEndpoints.getStateIds(roomId);
			return await this.requestService.get<EventBase[]>(domain, uri);
		} catch (error: any) {
			this.logger.error(`getStateIds failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Get server version information
	 */
	async getVersion(domain: string): Promise<Version> {
		try {
			return await this.requestService.get<Version>(
				domain,
				FederationEndpoints.version,
			);
		} catch (error: any) {
			this.logger.error(`getVersion failed: ${error?.message}`, error?.stack);
			throw error;
		}
	}

	/**
	 * Verify PDU from a remote server
	 */
	async verifyPDU<
		T extends object & {
			signatures?: Record<string, Record<ProtocolVersionKey, string>>;
			unsigned?: unknown;
		},
	>(event: T, originServer: string): Promise<boolean> {
		return this.signatureService.verifySignature(event, originServer);
	}

	/**
	 * Send a room tombstone event to a remote server
	 */
	async sendTombstone(
		domain: string,
		tombstoneEvent: EventBase,
	): Promise<SendTransactionResponse> {
		try {
			return await this.sendEvent(domain, tombstoneEvent);
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			const errorStack = error instanceof Error ? error.stack : undefined;
			this.logger.error(`sendTombstone failed: ${errorMessage}`, errorStack);
			throw error;
		}
	}

	// invite user from another homeserver to our homeserver
	async inviteUser(inviteEvent: PersistentEventBase, roomVersion: string) {
		const uri = FederationEndpoints.inviteV2(
			inviteEvent.roomId,
			inviteEvent.eventId,
		);

		if (!inviteEvent.stateKey) {
			this.logger.debug(inviteEvent.event, 'invalid state_key');
			throw new Error(
				'failed to send invite request, invite has invalid state_key',
			);
		}

		const residentServer = inviteEvent.stateKey.split(':').pop();

		if (!residentServer) {
			throw new Error(
				`invalid state_key ${inviteEvent.stateKey}, no domain found, failed to send invite`,
			);
		}

		return await this.requestService.put<any>(residentServer, uri, {
			event: inviteEvent.event,
			room_version: roomVersion,
			invite_room_state: await this.stateService.getStrippedRoomState(
				inviteEvent.roomId,
			),
		});
	}

	async sendEventToAllServersInRoom(event: PersistentEventBase) {
		const servers = await this.stateService.getServersInRoom(event.roomId);

		for (const server of servers) {
			if (server === event.origin) {
				this.logger.info(
					`Skipping transaction to event origin: ${event.origin}`,
				);
				continue;
			}

			if (server === this.configService.serverName) {
				this.logger.info(`Skipping transaction to local server: ${server}`);
				continue;
			}

			const txn: Transaction = {
				origin: 'rc1.tunnel.dev.rocket.chat', //this.configService.serverName,
				origin_server_ts: Date.now(),
				pdus: [event.event],
				edus: [],
			};

			this.logger.info(`Sending event ${event.eventId} to server: ${server}`);

			void this.sendTransaction(server, txn);
		}
	}
}
