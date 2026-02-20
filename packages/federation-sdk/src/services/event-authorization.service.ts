import { createLogger, extractSignaturesFromHeader, generateId, validateAuthorizationHeader } from '@rocket.chat/federation-core';
import type { EventID, Pdu, PersistentEventBase, RoomID } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import type { ConfigService } from './config.service';
import type { EventService } from './event.service';
import type { ServerService } from './server.service';
import type { StateService } from './state.service';
import { UploadRepository } from '../repositories/upload.repository';

export class AclDeniedError extends Error {
	constructor(serverName: string, roomId: string) {
		super(`Sender server ${serverName} denied by room ACL for room ${roomId}`);
		this.name = 'AclDeniedError';
	}
}

@singleton()
export class EventAuthorizationService {
	private readonly logger = createLogger('EventAuthorizationService');

	constructor(
		private readonly stateService: StateService,
		private readonly eventService: EventService,
		private readonly configService: ConfigService,
		private readonly serverService: ServerService,
		@inject(delay(() => UploadRepository))
		private readonly uploadRepository: UploadRepository,
	) {}

	async authorizeEvent(event: Pdu, authEvents: Pdu[]): Promise<boolean> {
		this.logger.debug(`Authorizing event ${generateId(event)} of type ${event.type}`);

		// Simple implementation - would need proper auth rules based on Matrix spec
		// https://spec.matrix.org/v1.7/server-server-api/#checks-performed-on-receipt-of-a-pdu

		if (event.type === 'm.room.create') {
			return this.authorizeCreateEvent(event);
		}

		// Check sender is allowed to send this type of event
		const senderAllowed = this.checkSenderAllowed(event, authEvents);
		if (!senderAllowed) {
			this.logger.warn(`Sender ${event.sender} not allowed to send ${event.type}`);
			return false;
		}

		// Check event-specific auth rules
		switch (event.type) {
			case 'm.room.member':
				return this.authorizeMemberEvent(event, authEvents);
			case 'm.room.power_levels':
				return this.authorizePowerLevelsEvent(event, authEvents);
			case 'm.room.join_rules':
				return this.authorizeJoinRulesEvent(event, authEvents);
			default:
				//  TODO: remove for simplicity, we'll allow other event types
				return true;
		}
	}

	private authorizeCreateEvent(event: Pdu): boolean {
		// Create events must not have prev_events
		if (event.prev_events && event.prev_events.length > 0) {
			this.logger.warn('Create event has prev_events');
			return false;
		}

		// Create events must not have auth_events
		if (event.auth_events && event.auth_events.length > 0) {
			this.logger.warn('Create event has auth_events');
			return false;
		}

		return true;
	}

	private checkSenderAllowed(event: Pdu, authEvents: Pdu[]): boolean {
		// Find power levels
		const powerLevelsEvent = authEvents.find((e) => e.type === 'm.room.power_levels');
		if (!powerLevelsEvent) {
			// No power levels - only allow room creator?
			const createEvent = authEvents.find((e) => e.type === 'm.room.create');
			if (createEvent && createEvent.sender === event.sender) {
				return true;
			}

			// If no create event either, allow by default
			return !createEvent;
		}

		//  TODO: Check if sender has permission - simplified implementation
		// Full implementation would need to check specific event type power levels
		return true;
	}

	private authorizeMemberEvent(_event: Pdu, _authEvents: Pdu[]): boolean {
		// TODO:  Basic implementation - full one would check join rules, bans, etc.
		return true;
	}

	private authorizePowerLevelsEvent(_event: Pdu, _authEvents: Pdu[]): boolean {
		// TODO:  Check sender has permission to change power levels
		return true;
	}

	private authorizeJoinRulesEvent(_event: Pdu, _authEvents: Pdu[]): boolean {
		// TODO: Check sender has permission to change join rules
		return true;
	}

	async verifyRequestSignature(
		authorizationHeader: string,
		method: string,
		uri: string,
		body?: Record<string, unknown>,
	): Promise<string | undefined> {
		if (!authorizationHeader?.startsWith('X-Matrix')) {
			this.logger.debug('Missing or invalid X-Matrix authorization header');
			return;
		}

		try {
			const { origin, destination, key, signature } = extractSignaturesFromHeader(authorizationHeader);

			if (!origin || !key || !signature || (destination && destination !== this.configService.serverName)) {
				return;
			}

			const [algorithm] = key.split(':');
			if (algorithm !== 'ed25519') {
				return;
			}

			const publicKey = await this.serverService.getPublicKey(origin, key);
			if (!publicKey) {
				this.logger.warn(`Could not fetch public key for ${origin}:${key}`);
				return;
			}

			const actualDestination = destination || this.configService.serverName;
			const isValid = await validateAuthorizationHeader(origin, publicKey, actualDestination, method, uri, signature, body);
			if (!isValid) {
				this.logger.warn(`Invalid signature from ${origin}`);
				return;
			}

			return origin;
		} catch (error) {
			this.logger.error({
				msg: 'Error verifying request signature',
				err: error,
			});
		}
	}

	private matchesServerPattern(serverName: string, pattern: string): boolean {
		if (serverName === pattern) {
			return true;
		}

		if (pattern.length > 200 || (pattern.match(/[*?]/g) || []).length > 20) {
			this.logger.warn(`ACL pattern too complex, rejecting: ${pattern}`);
			return false;
		}

		let regexPattern = pattern
			.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			.replace(/\*/g, '.*')
			.replace(/\?/g, '.');

		regexPattern = `^${regexPattern}$`;

		try {
			const regex = new RegExp(regexPattern);
			return regex.test(serverName);
		} catch (error) {
			this.logger.warn({ msg: `Invalid ACL pattern: ${pattern}`, error });
			return false;
		}
	}

	// as per Matrix spec: https://spec.matrix.org/v1.15/client-server-api/#mroomserver_acl
	async checkServerAcl(aclEvent: PersistentEventBase | undefined, serverName: string): Promise<boolean> {
		if (!aclEvent || !aclEvent.isServerAclEvent()) {
			return true;
		}

		const serverAclContent = aclEvent.getContent();
		const { allow = [], deny = [], allow_ip_literals = true } = serverAclContent;

		const isIpLiteral = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(serverName) || /^\[.*\](:\d+)?$/.test(serverName); // IPv6
		if (isIpLiteral && !allow_ip_literals) {
			this.logger.debug(`Server ${serverName} denied: IP literals not allowed`);
			return false;
		}

		for (const pattern of deny) {
			if (this.matchesServerPattern(serverName, pattern)) {
				this.logger.debug(`Server ${serverName} matches deny pattern: ${pattern}`);
				return false;
			}
		}

		// if allow list is empty, deny all servers (as per Matrix spec)
		// empty allow list means no servers are allowed
		if (allow.length === 0) {
			this.logger.debug(`Server ${serverName} denied: allow list is empty`);
			return false;
		}

		for (const pattern of allow) {
			if (this.matchesServerPattern(serverName, pattern)) {
				this.logger.debug(`Server ${serverName} matches allow pattern: ${pattern}`);
				return true;
			}
		}

		this.logger.debug(`Server ${serverName} not in allow list`);
		return false;
	}

	async checkAclForInvite(roomId: RoomID, senderServer: string): Promise<void> {
		const state = await this.stateService.getLatestRoomState(roomId);

		const aclEvent = state.get('m.room.server_acl:');
		if (!aclEvent) {
			return;
		}

		const isAllowed = await this.checkServerAcl(aclEvent, senderServer);
		if (!isAllowed) {
			this.logger.warn(`Sender ${senderServer} denied by room ${roomId} ACL`);
			throw new AclDeniedError(senderServer, roomId);
		}
	}

	async serverHasAccessToResource(roomId: RoomID, serverName: string): Promise<boolean> {
		const state = await this.stateService.getLatestRoomState(roomId);
		if (!state) {
			this.logger.debug(`Room ${roomId} not found`);
			return false;
		}

		const aclEvent = state.get('m.room.server_acl:');
		const isServerAllowed = await this.checkServerAcl(aclEvent, serverName);
		if (!isServerAllowed) {
			this.logger.warn(`Server ${serverName} is denied by room ACL for room ${roomId}`);
			return false;
		}

		const serversInRoom = await this.stateService.getServersInRoom(roomId);
		if (serversInRoom.includes(serverName)) {
			this.logger.debug(`Server ${serverName} is in room, allowing access`);
			return true;
		}

		for (const [key, event] of state.entries()) {
			if (key.startsWith('m.room.member:') && event?.isMembershipEvent()) {
				const membership = event.getContent()?.membership;
				const { stateKey } = event;

				if (!membership || !stateKey || !stateKey.includes(':')) {
					continue;
				}

				if (membership === 'invite') {
					const invitedUserServer = stateKey.split(':').pop();
					if (invitedUserServer === serverName) {
						this.logger.debug(`Server ${serverName} has pending invites in room, allowing access`);
						return true;
					}
				}
			}
		}

		const historyVisibilityEvent = state.get('m.room.history_visibility:');
		if (historyVisibilityEvent?.isHistoryVisibilityEvent() && historyVisibilityEvent.getContent().history_visibility === 'world_readable') {
			this.logger.debug(`Room ${roomId} is world_readable, allowing ${serverName}`);
			return true;
		}

		this.logger.debug(`Server ${serverName} not authorized: not in room and room not world_readable`);
		return false;
	}

	async canAccessEvent(eventId: EventID, serverName: string): Promise<boolean> {
		const event = await this.eventService.getEventById(eventId);
		if (!event) {
			this.logger.debug(`Event ${eventId} not found`);
			return false;
		}

		return this.serverHasAccessToResource(event.event.room_id, serverName);
	}

	async canAccessMedia(mediaId: string, serverName: string): Promise<boolean> {
		const rcUpload = await this.uploadRepository.findByMediaId(mediaId);
		if (!rcUpload) {
			this.logger.debug(`Media ${mediaId} not found in any room`);
			return false;
		}

		return this.serverHasAccessToResource(rcUpload.federation.mrid, serverName);
	}

	async canAccessRoom(roomId: RoomID, serverName: string): Promise<boolean> {
		return this.serverHasAccessToResource(roomId, serverName);
	}

	async canAccessResource<T extends 'event' | 'room' | 'media'>(
		entityType: T,
		entityId: T extends 'event' ? EventID : T extends 'room' ? RoomID : string,
		serverName: string,
	): Promise<boolean> {
		if (entityType === 'event') {
			return this.canAccessEvent(entityId as EventID, serverName);
		}

		if (entityType === 'room') {
			return this.canAccessRoom(entityId as RoomID, serverName);
		}

		if (entityType === 'media') {
			return this.canAccessMedia(entityId, serverName);
		}

		return false;
	}

	/**
	 * @deprecated Use canAccessEvent instead
	 */
	async canAccessEventFromAuthorizationHeader(
		eventId: EventID,
		authorizationHeader: string,
		method: string,
		uri: string,
		body?: Record<string, unknown>,
	): Promise<
		| { authorized: true }
		| {
				authorized: false;
				errorCode: 'M_UNAUTHORIZED' | 'M_FORBIDDEN' | 'M_UNKNOWN';
		  }
	> {
		try {
			const signatureResult = await this.verifyRequestSignature(
				method,
				uri,
				authorizationHeader,
				body, // keep body due to canonical json validation
			);
			if (!signatureResult) {
				return {
					authorized: false,
					errorCode: 'M_UNAUTHORIZED',
				};
			}

			const authorized = await this.canAccessEvent(eventId, signatureResult);
			if (!authorized) {
				return {
					authorized: false,
					errorCode: 'M_FORBIDDEN',
				};
			}

			return {
				authorized: true,
			};
		} catch (error) {
			this.logger.error({
				err: error,
				eventId,
				authorizationHeader,
				method,
				uri,
				body,
				msg: 'Error checking event access',
			});
			return {
				authorized: false,
				errorCode: 'M_UNKNOWN',
			};
		}
	}

	/**
	 * @deprecated Use canAccessMedia instead
	 */

	async canAccessMediaFromAuthorizationHeader(
		mediaId: string,
		authorizationHeader: string,
		method: string,
		uri: string,
		body?: Record<string, unknown>,
	): Promise<
		| { authorized: true }
		| {
				authorized: false;
				errorCode: 'M_UNAUTHORIZED' | 'M_FORBIDDEN' | 'M_UNKNOWN';
		  }
	> {
		try {
			const signatureResult = await this.verifyRequestSignature(method, uri, authorizationHeader, body);
			if (!signatureResult) {
				return {
					authorized: false,
					errorCode: 'M_UNAUTHORIZED',
				};
			}

			const authorized = await this.canAccessMedia(mediaId, signatureResult);
			if (!authorized) {
				return {
					authorized: false,
					errorCode: 'M_FORBIDDEN',
				};
			}

			return {
				authorized: true,
			};
		} catch (error) {
			this.logger.error({
				err: error,
				mediaId,
				authorizationHeader,
				method,
				uri,
				msg: 'Error checking media access',
			});
			return {
				authorized: false,
				errorCode: 'M_UNKNOWN',
			};
		}
	}
}
