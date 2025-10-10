import type { EventBase } from '@rocket.chat/federation-core';
import type { BaseEDU } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import {
	Pdu,
	PersistentEventBase,
	PersistentEventFactory,
	extractDomainFromId,
} from '@rocket.chat/federation-room';
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
			const queryParams: Record<string, string | string[]> = {};

			if (version) {
				queryParams.ver = version;
			} else {
				queryParams.ver = PersistentEventFactory.supportedRoomVersions;
			}

			return await this.requestService.get<MakeJoinResponse>(
				domain,
				uri,
				queryParams,
			);
		} catch (error: any) {
			this.logger.error({ msg: 'makeJoin failed', err: error });
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
				this.logger.debug({ msg: 'invalid room_id', event: joinEvent.event });
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
			this.logger.error({ msg: 'sendJoin failed', err: error });
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
			this.logger.error({ msg: 'sendTransaction failed', err: error });
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
			this.logger.error({ msg: 'sendEvent failed', err: error });
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
			this.logger.error({ msg: 'getEvent failed', err: error });
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
			this.logger.error({ msg: 'getState failed', err: error });
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
			this.logger.error({ msg: 'getStateIds failed', err: error });
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
			this.logger.error({ msg: 'getVersion failed', err: error });
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
			this.logger.debug({ msg: 'invalid state_key', event: inviteEvent.event });
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
		const servers = await this.stateService.getServerSetInRoom(event.roomId);

		if (event.stateKey) {
			try {
				const server = extractDomainFromId(event.stateKey);
				if (server && !servers.has(server)) {
					servers.add(server);
				}
			} catch (error) {
				this.logger.error(
					{ error, eventId: event.eventId, stateKey: event.stateKey },
					'Failed to extract server from stateKey',
				);
			}
		}

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

			this.logger.info({
				transaction: txn,
				msg: `Sending event ${event.eventId} to server: ${server}`,
			});

			try {
				await this.sendTransaction(server, txn);
			} catch (error) {
				this.logger.error({
					msg: `Failed to send event ${event.eventId} to server: ${server}`,
					err: error,
				});
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
					this.logger.error({
						msg: `Failed to send EDUs to server: ${server}`,
						err: error,
					});
					// Continue with next batch/server even if one fails
				}
			}
		}
	}
}
