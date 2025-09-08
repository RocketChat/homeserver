import type { EventBase } from '@hs/core';
import type { BaseEDU } from '@hs/core';
import type { ProtocolVersionKey } from '@hs/core';
import { createLogger } from '@hs/core';
import {
	Pdu,
	PduForType,
	PersistentEventBase,
	PersistentEventFactory,
} from '@hs/room';
import { singleton } from 'tsyringe';
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
import { StateService } from './state.service';

@singleton()
export class FederationService {
	private readonly logger = createLogger('FederationService');

	constructor(
		private readonly configService: ConfigService,
		private readonly requestService: FederationRequestService,

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
	async sendEvent<T extends Pdu>(
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
	async getEvent(domain: string, eventId: string): Promise<Pdu> {
		try {
			const uri = FederationEndpoints.getEvent(eventId);
			return await this.requestService.get<Pdu>(domain, uri);
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

			// TODO: signing should happen here over local persisting
			// should be handled in transaction queue implementation
			await this.stateService.signEvent(event);

			const txn: Transaction = {
				origin: this.configService.serverName,
				origin_server_ts: Date.now(),
				pdus: [event.event],
				edus: [],
			};

			this.logger.info(
				{ transaction: txn },
				`Sending event ${event.eventId} to server: ${server}`,
			);

			try {
				await this.sendTransaction(server, txn);
			} catch (error) {
				this.logger.error(
					`Failed to send event ${event.eventId} to server: ${server}`,
					error,
				);
			}
		}
	}

	async sendEDUToServers(edus: BaseEDU[], servers: string[]): Promise<void> {
		// Process servers sequentially to avoid concurrent transactions per Matrix spec
		for (const server of servers) {
			if (server === this.configService.serverName) {
				this.logger.info(`Skipping EDU to local server: ${server}`);
				continue;
			}

			// Respect Matrix spec transaction limits: max 100 EDUs per transaction
			const maxEDUsPerTransaction = 100;
			const batches = [];

			for (let i = 0; i < edus.length; i += maxEDUsPerTransaction) {
				batches.push(edus.slice(i, i + maxEDUsPerTransaction));
			}

			for (const batch of batches) {
				const txn: Transaction = {
					origin: this.configService.serverName,
					origin_server_ts: Date.now(),
					pdus: [],
					edus: batch,
				};

				this.logger.info(`Sending ${batch.length} EDUs to server: ${server}`);

				try {
					await this.sendTransaction(server, txn);
				} catch (error) {
					this.logger.error(`Failed to send EDUs to server: ${server}`, error);
					// Continue with next batch/server even if one fails
				}
			}
		}
	}
}
