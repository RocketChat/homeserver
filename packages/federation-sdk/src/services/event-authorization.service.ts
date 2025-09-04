import {
	JoinRule,
	RoomJoinRulesEvent,
	RoomMemberEvent,
	createLogger,
	extractSignaturesFromHeader,
	generateId,
	validateAuthorizationHeader,
} from '@hs/core';
import type { Pdu } from '@hs/room';
import { singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { SignatureVerificationService } from './signature-verification.service';
import { State, StateService } from './state.service';

@singleton()
export class EventAuthorizationService {
	private readonly logger = createLogger('EventAuthorizationService');

	constructor(
		private readonly stateService: StateService,
		private readonly eventService: EventService,
		private readonly signatureVerificationService: SignatureVerificationService,
		private readonly configService: ConfigService,
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

	public async verifyRequestSignature(request: {
		method: string;
		uri: string;
		headers: Record<string, string>;
		body?: unknown;
	}): Promise<
		| {
				valid: true;
				serverName: string;
		  }
		| {
				valid: false;
				error: string;
		  }
	> {
		const authHeader = request.headers.Authorization;
		if (!authHeader?.startsWith('X-Matrix')) {
			return {
				valid: false,
				error: 'Missing or invalid X-Matrix authorization header',
			};
		}

		try {
			const { origin, destination, key, signature } =
				extractSignaturesFromHeader(authHeader);

			if (destination && destination !== this.configService.serverName) {
				return {
					valid: false,
					error: 'Request destination does not match this server',
				};
			}

			const [algorithm] = key.split(':');
			if (algorithm !== 'ed25519') {
				return {
					valid: false,
					error: `Unsupported signature algorithm: ${algorithm}`,
				};
			}

			const publicKey =
				await this.signatureVerificationService.getOrFetchPublicKey(
					origin,
					key,
				);
			if (!publicKey) {
				return {
					valid: false,
					error: 'Could not fetch server signing key',
				};
			}

			const isValid = await validateAuthorizationHeader(
				origin,
				publicKey.verify_keys[key].key,
				destination || this.configService.serverName,
				request.method,
				request.uri,
				signature,
				request.body as object,
			);

			if (!isValid) {
				return {
					valid: false,
					error: 'Invalid signature',
				};
			}

			return {
				valid: true,
				serverName: origin,
			};
		} catch (error) {
			return {
				valid: false,
				error:
					error instanceof Error ? error.message : 'Failed to verify signature',
			};
		}
	}

	public async canAccessEvent(
		eventId: string,
		serverName: string,
	): Promise<
		| {
				authorized: true;
		  }
		| {
				authorized: false;
				reason: string;
				errorCode: string;
		  }
	> {
		try {
			const event = await this.eventService.getEventById(eventId);
			if (!event) {
				return {
					authorized: false,
					reason: 'Event not found',
					errorCode: 'M_NOT_FOUND',
				};
			}

			const roomId = event.event.room_id;

			const serversInRoom = await this.stateService.getServersInRoom(roomId);
			if (serversInRoom.includes(serverName)) {
				return { authorized: true };
			}

			const roomState = await this.stateService.getFullRoomState(roomId);
			// for (const [, stateEvent] of roomState) {
			// 	if (stateEvent.type === 'm.room.history_visibility') {
			// 		const content = stateEvent.getContent();
			// 		if (content?.history_visibility === 'world_readable') {
			// 			return { authorized: true };
			// 		}
			// 		break;
			// 	}
			// }

			// For restricted visibility, check if server had access at event times
			const joinRules = this.getJoinRules(roomState);
			if (joinRules === 'public') {
				// Public rooms with non-world_readable visibility still require membership
				return {
					authorized: false,
					reason: 'Server is not a member of this room',
					errorCode: 'M_FORBIDDEN',
				};
			}

			// For invite-only rooms, check historical membership
			const stateAtEvent =
				await this.stateService.findStateBeforeEvent(eventId);
			for (const [, stateEvent] of stateAtEvent) {
				if (stateEvent.type === 'm.room.member') {
					const content = stateEvent.getContent() as RoomMemberEvent['content'];
					if (
						content?.membership === 'join' &&
						stateEvent.stateKey?.split(':')[1] === serverName
					) {
						return { authorized: true };
					}
				}
			}

			return {
				authorized: false,
				reason: 'Server does not have access to this event',
				errorCode: 'M_FORBIDDEN',
			};
		} catch (error) {
			this.logger.error(
				{ error, eventId, serverName },
				'Error checking event access',
			);
			return {
				authorized: false,
				reason: 'Internal error checking authorization',
				errorCode: 'M_UNKNOWN',
			};
		}
	}

	private getJoinRules(roomState: State): JoinRule {
		for (const [, event] of roomState) {
			if (event.type === 'm.room.join_rules') {
				return event.getContent<RoomJoinRulesEvent['content']>().join_rule;
			}
		}

		return 'invite';
	}
}
