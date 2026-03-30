import type { EventBase, BaseEDU } from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import { EventID, Pdu, PersistentEventBase, PersistentEventFactory, extractDomainFromId } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationRequestService } from './federation-request.service';
import { FederationSenderService } from './federation-sender.service';
import { StateService } from './state.service';
import { FederationEndpoints, type MakeJoinResponse, type SendJoinResponse, type Version } from '../specs/federation-api';

@singleton()
export class FederationService {
	private readonly logger = createLogger('FederationService');

	constructor(
		private readonly configService: ConfigService,
		private readonly requestService: FederationRequestService,
		private readonly stateService: StateService,
		private readonly federationSenderService: FederationSenderService,
	) {}

	/**
	 * Get a make_join template for a room and user
	 */
	async makeJoin(domain: string, roomId: string, userId: string, version?: string): Promise<MakeJoinResponse> {
		try {
			const uri = FederationEndpoints.makeJoin(roomId, userId);
			const queryParams: Record<string, string | string[]> = {};

			if (version) {
				queryParams.ver = version;
			} else {
				queryParams.ver = PersistentEventFactory.supportedRoomVersions;
			}

			return await this.requestService.get<MakeJoinResponse>(domain, uri, queryParams);
		} catch (error: any) {
			this.logger.error({ msg: 'makeJoin failed', err: error });
			throw error;
		}
	}

	/**
	 * Send a join event to a remote server
	 */
	async sendJoin(joinEvent: PersistentEventBase, omitMembers = false): Promise<SendJoinResponse> {
		try {
			const uri = FederationEndpoints.sendJoinV2(joinEvent.roomId, joinEvent.eventId);
			const queryParams = omitMembers ? { omit_members: 'true' } : undefined;

			const residentServer = joinEvent.roomId.split(':').pop();

			if (!residentServer) {
				this.logger.debug({ msg: 'invalid room_id', event: joinEvent.event });
				throw new Error(`invalid room_id ${joinEvent.roomId}, no server_name part`);
			}

			return await this.requestService.put<SendJoinResponse>(residentServer, uri, undefined, queryParams, joinEvent.event);
		} catch (error: any) {
			this.logger.error({ msg: 'sendJoin failed', err: error });
			throw error;
		}
	}

	async makeLeave(domain: string, roomId: string, userId: string): Promise<{ event: Pdu; room_version: string }> {
		try {
			const uri = FederationEndpoints.makeLeave(roomId, userId);
			return await this.requestService.get<{
				event: Pdu;
				room_version: string;
			}>(domain, uri);
		} catch (error: any) {
			this.logger.error({ msg: 'makeLeave failed', err: error });
			throw error;
		}
	}

	async sendLeave(leaveEvent: PersistentEventBase): Promise<void> {
		try {
			const uri = FederationEndpoints.sendLeave(leaveEvent.roomId, leaveEvent.eventId);

			const residentServer = leaveEvent.roomId.split(':').pop();

			if (!residentServer) {
				this.logger.debug({ msg: 'invalid room_id', event: leaveEvent.event });
				throw new Error(`invalid room_id ${leaveEvent.roomId}, no server_name part`);
			}

			await this.requestService.put<void>(residentServer, uri, leaveEvent.event);
		} catch (error: any) {
			this.logger.error({ msg: 'sendLeave failed', err: error });
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
	 * Get events from a remote server
	 */
	async getMissingEvents(
		domain: string,
		roomId: string,
		earliestEvents: EventID[],
		latestEvents: EventID[],
		limit = 10,
		minDepth = 0,
	): Promise<{ events: Pdu[] }> {
		try {
			const uri = FederationEndpoints.getMissingEvents(roomId);
			return await this.requestService.post<{ events: Pdu[] }>(domain, uri, {
				earliest_events: earliestEvents,
				latest_events: latestEvents,
				limit,
				min_depth: minDepth,
			});
		} catch (error: any) {
			this.logger.error({ msg: 'getEvent failed', err: error });
			throw error;
		}
	}

	/**
	 * Get state for a room from remote server
	 */
	async getState(domain: string, roomId: string, eventId: string): Promise<EventBase> {
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
			return await this.requestService.get<Version>(domain, FederationEndpoints.version);
		} catch (error: any) {
			this.logger.error({ msg: 'getVersion failed', err: error });
			throw error;
		}
	}

	// invite user from another homeserver to our homeserver
	async inviteUser(inviteEvent: PersistentEventBase, roomVersion: string) {
		const uri = FederationEndpoints.inviteV2(inviteEvent.roomId, inviteEvent.eventId);

		if (!inviteEvent.stateKey) {
			this.logger.debug({ msg: 'invalid state_key', event: inviteEvent.event });
			throw new Error('failed to send invite request, invite has invalid state_key');
		}

		const residentServer = inviteEvent.stateKey.split(':').pop();

		if (!residentServer) {
			throw new Error(`invalid state_key ${inviteEvent.stateKey}, no domain found, failed to send invite`);
		}

		return this.requestService.put<any>(residentServer, uri, {
			event: inviteEvent.event,
			room_version: roomVersion,
			invite_room_state: await this.stateService.getStrippedRoomState(inviteEvent.roomId),
		});
	}

	async sendEventToAllServersInRoom(event: PersistentEventBase, omitDestinations: string[] = []): Promise<void> {
		// TODO we need a map of rooms and destinations to avoid having to get rooms state just to send an event to all servers in the room.
		const servers = await this.stateService.getServerSetInRoom(event.roomId);

		if (event.stateKey) {
			const server = extractDomainFromId(event.stateKey);
			if (!servers.has(server)) {
				servers.add(server);
			}
		}

		// Filter out the event origin, local server, and any additional omitted destinations
		const destinations = Array.from(servers).filter(
			(server) => server !== event.origin && server !== this.configService.serverName && !omitDestinations.includes(server),
		);

		if (destinations.length === 0) {
			this.logger.debug(`No destinations to send event ${event.eventId}`);
			return;
		}

		// Sign the event once before queuing
		await this.stateService.signEvent(event);

		this.logger.info(`Queueing event ${event.eventId} for ${destinations.length} destinations`);

		// Queue the event for all destinations
		this.federationSenderService.sendPDUToMultiple(destinations, event.event);
	}

	async sendEDUToServers(edus: BaseEDU[], servers: string[]): Promise<void> {
		// Filter out local server
		const destinations = servers.filter((server) => server !== this.configService.serverName);

		if (destinations.length === 0) {
			this.logger.debug('No destinations to send EDUs');
			return;
		}

		this.logger.info(`Queueing ${edus.length} EDUs for ${destinations.length} destinations`);

		// Queue EDUs for all destinations
		// The per-destination queue will handle batching and retry logic
		this.federationSenderService.sendEDUToMultiple(destinations, edus);
	}

	/**
	 * Notify that a remote server is back online.
	 * This clears backoff and triggers immediate retry for pending events.
	 * Should be called when receiving an incoming request from the remote server.
	 */
	notifyRemoteServerUp(serverName: string): void {
		this.federationSenderService.notifyRemoteServerUp(serverName);
	}
}
