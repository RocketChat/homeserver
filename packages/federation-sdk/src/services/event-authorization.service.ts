import {
	createLogger,
	extractSignaturesFromHeader,
	generateId,
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
	validateAuthorizationHeader,
} from '@hs/core';
import type { EventID, Pdu, PersistentEventBase } from '@hs/room';
import { singleton } from 'tsyringe';
import { KeyRepository } from '../repositories/key.repository';
import { MatrixBridgedRoomRepository } from '../repositories/matrix-bridged-room.repository';
import { UploadRepository } from '../repositories/upload.repository';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { StateService } from './state.service';

@singleton()
export class EventAuthorizationService {
	private readonly logger = createLogger('EventAuthorizationService');

	constructor(
		private readonly stateService: StateService,
		private readonly eventService: EventService,
		private readonly configService: ConfigService,
		private readonly uploadRepository: UploadRepository,
		private readonly matrixBridgedRoomRepository: MatrixBridgedRoomRepository,
		private readonly keyRepository: KeyRepository,
	) {}

	async authorizeEvent(event: Pdu, authEvents: Pdu[]): Promise<boolean> {
		this.logger.debug(
			`Authorizing event ${generateId(event)} of type ${event.type}`,
		);

		// Simple implementation - would need proper auth rules based on Matrix spec
		// https://spec.matrix.org/v1.7/server-server-api/#checks-performed-on-receipt-of-a-pdu

		if (event.type === 'm.room.create') {
			return this.authorizeCreateEvent(event);
		}

		// Check sender is allowed to send this type of event
		const senderAllowed = this.checkSenderAllowed(event, authEvents);
		if (!senderAllowed) {
			this.logger.warn(
				`Sender ${event.sender} not allowed to send ${event.type}`,
			);
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
		const powerLevelsEvent = authEvents.find(
			(e) => e.type === 'm.room.power_levels',
		);
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

	private async verifyRequestSignature(
		method: string,
		uri: string,
		authorizationHeader: string,
		body?: Record<string, unknown>,
	): Promise<string | undefined> {
		if (!authorizationHeader?.startsWith('X-Matrix')) {
			this.logger.debug('Missing or invalid X-Matrix authorization header');
			return;
		}

		try {
			const { origin, destination, key, signature } =
				extractSignaturesFromHeader(authorizationHeader);

			if (
				!origin ||
				!key ||
				!signature ||
				(destination && destination !== this.configService.serverName)
			) {
				return;
			}

			const [algorithm] = key.split(':');
			if (algorithm !== 'ed25519') {
				return;
			}

			// TODO: move makeGetPublicKeyFromServerProcedure procedure to a proper service
			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				(origin, keyId) =>
					this.keyRepository.getValidPublicKeyFromLocal(origin, keyId),
				(origin, key) =>
					getPublicKeyFromRemoteServer(
						origin,
						this.configService.serverName,
						key,
					),
				(origin, keyId, publicKey) =>
					this.keyRepository.storePublicKey(origin, keyId, publicKey),
			);
			const publicKey = await getPublicKeyFromServer(origin, key);
			if (!publicKey) {
				this.logger.warn(`Could not fetch public key for ${origin}:${key}`);
				return;
			}

			const actualDestination = destination || this.configService.serverName;
			const isValid = await validateAuthorizationHeader(
				origin,
				publicKey,
				actualDestination,
				method,
				uri,
				signature,
				body,
			);
			if (!isValid) {
				this.logger.warn(`Invalid signature from ${origin}`);
				return;
			}

			return origin;
		} catch (error) {
			this.logger.error(error, 'Error verifying request signature');
			return;
		}
	}

	private async canAccessEvent(
		eventId: EventID,
		serverName: string,
	): Promise<boolean> {
		try {
			const event = await this.eventService.getEventById(eventId);
			if (!event) {
				this.logger.debug(`Event ${eventId} not found`);
				return false;
			}

			const roomId = event.event.room_id;
			const state = await this.stateService.getFullRoomState(roomId);

			const aclEvent = state.get('m.room.server_acl:');
			const isServerAllowed = await this.checkServerAcl(aclEvent, serverName);
			if (!isServerAllowed) {
				this.logger.warn(
					`Server ${serverName} is denied by room ACL for room ${roomId}`,
				);
				return false;
			}

			const serversInRoom = await this.stateService.getServersInRoom(roomId);
			if (serversInRoom.includes(serverName)) {
				this.logger.debug(`Server ${serverName} is in room, allowing access`);
				return true;
			}

			const historyVisibilityEvent = state.get('m.room.history_visibility:');
			if (
				historyVisibilityEvent?.isHistoryVisibilityEvent() &&
				historyVisibilityEvent.getContent().history_visibility ===
					'world_readable'
			) {
				this.logger.debug(
					`Event ${eventId} is world_readable, allowing ${serverName}`,
				);
				return true;
			}

			this.logger.debug(
				`Server ${serverName} not authorized: not in room and event not world_readable`,
			);
			return false;
		} catch (err) {
			this.logger.error('Error checking event access', err);
			return false;
		}
	}

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
			this.logger.error(
				{ error, eventId, authorizationHeader, method, uri, body },
				'Error checking event access',
			);
			return {
				authorized: false,
				errorCode: 'M_UNKNOWN',
			};
		}
	}

	// as per Matrix spec: https://spec.matrix.org/v1.15/client-server-api/#mroomserver_acl
	private async checkServerAcl(
		aclEvent: PersistentEventBase | undefined,
		serverName: string,
	): Promise<boolean> {
		if (!aclEvent || !aclEvent.isServerAclEvent()) {
			return true;
		}

		const serverAclContent = aclEvent.getContent();
		const {
			allow = [],
			deny = [],
			allow_ip_literals = true,
		} = serverAclContent;

		const isIpLiteral =
			/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(serverName) ||
			/^\[.*\](:\d+)?$/.test(serverName); // IPv6
		if (isIpLiteral && !allow_ip_literals) {
			this.logger.debug(`Server ${serverName} denied: IP literals not allowed`);
			return false;
		}

		for (const pattern of deny) {
			if (this.matchesServerPattern(serverName, pattern)) {
				this.logger.debug(
					`Server ${serverName} matches deny pattern: ${pattern}`,
				);
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
				this.logger.debug(
					`Server ${serverName} matches allow pattern: ${pattern}`,
				);
				return true;
			}
		}

		this.logger.debug(`Server ${serverName} not in allow list`);
		return false;
	}

	private matchesServerPattern(serverName: string, pattern: string): boolean {
		if (serverName === pattern) {
			return true;
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
			this.logger.warn(`Invalid ACL pattern: ${pattern}`, error);
			return false;
		}
	}

	async canAccessMedia(mediaId: string, serverName: string): Promise<boolean> {
		try {
			const rcRoomId =
				await this.uploadRepository.findRocketChatRoomIdByMediaId(mediaId);
			if (!rcRoomId) {
				this.logger.debug(`Media ${mediaId} not found in any room`);
				return false;
			}

			const matrixRoomId =
				await this.matrixBridgedRoomRepository.findMatrixRoomId(rcRoomId);
			if (!matrixRoomId) {
				this.logger.debug(`Media ${mediaId} not found in any room`);
				return false;
			}

			const state = await this.stateService.getFullRoomState(matrixRoomId);

			const aclEvent = state.get('m.room.server_acl:');
			const isServerAllowed = await this.checkServerAcl(aclEvent, serverName);
			if (!isServerAllowed) {
				this.logger.warn(
					`Server ${serverName} is denied by room ACL for media in room ${matrixRoomId}`,
				);
				return false;
			}

			const serversInRoom =
				await this.stateService.getServersInRoom(matrixRoomId);
			if (serversInRoom.includes(serverName)) {
				this.logger.debug(
					`Server ${serverName} is in room ${matrixRoomId}, allowing media access`,
				);
				return true;
			}

			const historyVisibilityEvent = state.get('m.room.history_visibility:');
			if (
				historyVisibilityEvent?.isHistoryVisibilityEvent() &&
				historyVisibilityEvent.getContent().history_visibility ===
					'world_readable'
			) {
				this.logger.debug(
					`Room ${matrixRoomId} is world_readable, allowing media access to ${serverName}`,
				);
				return true;
			}

			this.logger.debug(
				`Server ${serverName} not authorized for media ${mediaId}: not in room and room not world_readable`,
			);
			return false;
		} catch (error) {
			this.logger.error(
				{ error, mediaId, serverName },
				'Error checking media access',
			);
			return false;
		}
	}

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
			const signatureResult = await this.verifyRequestSignature(
				method,
				uri,
				authorizationHeader,
				body,
			);
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
			this.logger.error(
				{ error, mediaId, authorizationHeader, method, uri },
				'Error checking media access',
			);
			return {
				authorized: false,
				errorCode: 'M_UNKNOWN',
			};
		}
	}
}
