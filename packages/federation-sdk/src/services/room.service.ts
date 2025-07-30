import {
	EventBase,
	RoomNameAuthEvents,
	RoomPowerLevelsEvent,
	RoomTombstoneEvent,
	SignedEvent,
	TombstoneAuthEvents,
	generateId,
	isRoomPowerLevelsEvent,
	roomMemberEvent,
	roomNameEvent,
	roomPowerLevelsEvent,
	roomTombstoneEvent,
	signEvent,
} from '@hs/core';
import { inject, singleton } from 'tsyringe';
import { FederationService } from './federation.service';

import { ForbiddenError, HttpException, HttpStatus } from '@hs/core';
import { type SigningKey } from '@hs/core';
import type { EventStore } from '@hs/core';

import { logger } from '@hs/core';
import {
	PduCreateEventContent,
	PduJoinRuleEventContent,
	PersistentEventBase,
	PersistentEventFactory,
} from '@hs/room';
import { EventRepository } from '../repositories/event.repository';
import type { RoomRepository } from '../repositories/room.repository';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { EventType } from './event.service';
import { StateService } from './state.service';

@singleton()
export class RoomService {
	constructor(
		@inject('RoomRepository') private readonly roomRepository: RoomRepository,
		@inject('EventRepository')
		private readonly eventRepository: EventRepository,
		@inject('EventService') private readonly eventService: EventService,
		@inject('ConfigService') private readonly configService: ConfigService,
		@inject('FederationService')
		private readonly federationService: FederationService,
		@inject('StateService') private readonly stateService: StateService,
	) {}

	private validatePowerLevelChange(
		currentPowerLevelsContent: RoomPowerLevelsEvent['content'],
		senderId: string,
		targetUserId: string,
		newPowerLevel: number,
	): void {
		const senderPower =
			currentPowerLevelsContent.users?.[senderId] ??
			currentPowerLevelsContent.users_default;

		// 1. Check if sender can modify m.room.power_levels event itself
		const requiredLevelToModifyEvent =
			currentPowerLevelsContent.events?.['m.room.power_levels'] ??
			currentPowerLevelsContent.state_default ??
			100;

		if (senderPower < requiredLevelToModifyEvent) {
			logger.warn(
				`Sender ${senderId} (power ${senderPower}) lacks global permission (needs ${requiredLevelToModifyEvent}) to modify power levels event.`,
			);
			throw new HttpException(
				"You don't have permission to change power levels events.",
				HttpStatus.FORBIDDEN,
			);
		}

		// 2. Specific checks when changing another user's power level
		if (senderId !== targetUserId) {
			const targetUserCurrentPower =
				currentPowerLevelsContent.users?.[targetUserId] ??
				currentPowerLevelsContent.users_default;

			// Rule: Cannot set another user's power level higher than one's own.
			if (newPowerLevel > senderPower) {
				logger.warn(
					`Sender ${senderId} (power ${senderPower}) cannot set user ${targetUserId}'s power to ${newPowerLevel} (higher than own).`,
				);
				throw new HttpException(
					"You cannot set another user's power level higher than your own.",
					HttpStatus.FORBIDDEN,
				);
			}

			// Rule: Cannot change power level of a user whose current power is >= sender's power.
			if (targetUserCurrentPower >= senderPower) {
				logger.warn(
					`Sender ${senderId} (power ${senderPower}) cannot change power level of user ${targetUserId} (current power ${targetUserCurrentPower}).`,
				);
				throw new HttpException(
					'You cannot change the power level of a user with equal or greater power than yourself.',
					HttpStatus.FORBIDDEN,
				);
			}
		}
	}

	private validateKickPermission(
		currentPowerLevelsContent: RoomPowerLevelsEvent['content'],
		senderId: string,
		kickedUserId: string,
	): void {
		const senderPower =
			currentPowerLevelsContent.users?.[senderId] ??
			currentPowerLevelsContent.users_default ??
			0;
		const kickedUserPower =
			currentPowerLevelsContent.users?.[kickedUserId] ??
			currentPowerLevelsContent.users_default ??
			0;
		const kickLevel = currentPowerLevelsContent.kick ?? 50; // Default kick level if not specified

		if (senderPower < kickLevel) {
			logger.warn(
				`Sender ${senderId} (power ${senderPower}) does not meet required power level (${kickLevel}) to kick users.`,
			);
			throw new HttpException(
				"You don't have permission to kick users from this room.",
				HttpStatus.FORBIDDEN,
			);
		}

		if (kickedUserPower >= senderPower) {
			logger.warn(
				`Sender ${senderId} (power ${senderPower}) cannot kick user ${kickedUserId} (power ${kickedUserPower}) who has equal or greater power.`,
			);
			throw new HttpException(
				'You cannot kick a user with power greater than or equal to your own.',
				HttpStatus.FORBIDDEN,
			);
		}
	}

	private validateBanPermission(
		currentPowerLevelsContent: RoomPowerLevelsEvent['content'],
		senderId: string,
		bannedUserId: string,
	): void {
		const senderPower =
			currentPowerLevelsContent.users?.[senderId] ??
			currentPowerLevelsContent.users_default ??
			0;
		const bannedUserPower =
			currentPowerLevelsContent.users?.[bannedUserId] ??
			currentPowerLevelsContent.users_default ??
			0;
		const banLevel = currentPowerLevelsContent.ban ?? 50; // Default ban level if not specified

		if (senderPower < banLevel) {
			logger.warn(
				`Sender ${senderId} (power ${senderPower}) does not meet required power level (${banLevel}) to ban users.`,
			);
			throw new HttpException(
				"You don't have permission to ban users from this room.",
				HttpStatus.FORBIDDEN,
			);
		}

		if (bannedUserPower >= senderPower) {
			logger.warn(
				`Sender ${senderId} (power ${senderPower}) cannot ban user ${bannedUserId} (power ${bannedUserPower}) who has equal or greater power.`,
			);
			throw new HttpException(
				'You cannot ban a user with power greater than or equal to your own.',
				HttpStatus.FORBIDDEN,
			);
		}
	}

	async upsertRoom(roomId: string, state: EventBase[]) {
		logger.info(`Upserting room ${roomId} with ${state.length} state events`);

		// Find the create event to determine room version
		const createEvent = state.find((event) => event.type === 'm.room.create');
		if (createEvent) {
			logger.info(`Found create event for room ${roomId}`);
		}

		// Find power levels
		const powerLevelsEvent = state.find(
			(event) => event.type === 'm.room.power_levels',
		);
		if (powerLevelsEvent) {
			logger.info(`Found power levels event for room ${roomId}`);
		}

		// Count member events
		const memberEvents = state.filter(
			(event) => event.type === 'm.room.member',
		);
		logger.info(`Room ${roomId} has ${memberEvents.length} member events`);

		try {
			await this.roomRepository.upsert(roomId, state);
			logger.info(`Successfully upserted room ${roomId}`);
		} catch (error) {
			logger.error(`Failed to upsert room ${roomId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Create a new room with the given sender and username
	 */
	async createRoom(
		username: string,
		name: string,
		joinRule: PduJoinRuleEventContent['join_rule'],
	) {
		logger.debug(
			`Creating room for ${username} with ${name} join_rule: ${joinRule}`,
		);

		const roomCreateEvent = PersistentEventFactory.newCreateEvent(
			username,
			PersistentEventFactory.defaultRoomVersion,
		);

		const stateService = this.stateService;

		await stateService.persistStateEvent(roomCreateEvent);

		const creatorMembershipEvent = PersistentEventFactory.newMembershipEvent(
			roomCreateEvent.roomId,
			username,
			username,
			'join',
			roomCreateEvent.getContent<PduCreateEventContent>(),
		);

		await stateService.addAuthEvents(creatorMembershipEvent);

		await stateService.addPrevEvents(creatorMembershipEvent);

		await stateService.persistStateEvent(creatorMembershipEvent);

		const roomNameEvent = PersistentEventFactory.newRoomNameEvent(
			roomCreateEvent.roomId,
			username,
			name,
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.addAuthEvents(roomNameEvent);

		await stateService.addPrevEvents(roomNameEvent);

		await stateService.persistStateEvent(roomNameEvent);

		const powerLevelEvent = PersistentEventFactory.newPowerLevelEvent(
			roomCreateEvent.roomId,
			username,
			{
				users: {
					[username]: 100,
				},
				users_default: 0,
				events: {},
				events_default: 0,
				state_default: 50,
				ban: 50,
				kick: 50,
				redact: 50,
				invite: 50,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.addAuthEvents(powerLevelEvent);

		await stateService.addPrevEvents(powerLevelEvent);

		await stateService.persistStateEvent(powerLevelEvent);

		const joinRuleEvent = PersistentEventFactory.newJoinRuleEvent(
			roomCreateEvent.roomId,
			username,
			joinRule,
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.addAuthEvents(joinRuleEvent);

		await stateService.addPrevEvents(joinRuleEvent);

		await stateService.persistStateEvent(joinRuleEvent);

		const canonicalAliasEvent = PersistentEventFactory.newCanonicalAliasEvent(
			roomCreateEvent.roomId,
			username,
			`#${name}:${this.configService.getServerConfig().name}`,
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.addAuthEvents(canonicalAliasEvent);

		await stateService.addPrevEvents(canonicalAliasEvent);

		await stateService.persistStateEvent(canonicalAliasEvent);

		return {
			room_id: roomCreateEvent.roomId,
			event_id: roomCreateEvent.eventId,
		};
	}

	async updateRoomName(
		roomId: string,
		name: string,
		senderId: string,
		targetServer: string,
	) {
		logger.info(
			`Updating room name for ${roomId} to \"${name}\" by ${senderId}`,
		);

		const lastEvent = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEvent) {
			throw new HttpException(
				'Room has no history, cannot update name',
				HttpStatus.BAD_REQUEST,
			);
		}

		const authEventIds = await this.eventService.getAuthEventIds(
			EventType.NAME,
			{ roomId, senderId },
		);
		const powerLevelsEventId = authEventIds.find(
			(e) => e.type === EventType.POWER_LEVELS,
		)?._id;

		const canUpdateRoomName = await this.eventService.checkUserPermission(
			powerLevelsEventId || '',
			senderId,
			EventType.NAME,
		);

		if (!canUpdateRoomName) {
			logger.warn(
				`User ${senderId} does not have permission to set room name in ${roomId} based on power levels.`,
			);
			throw new HttpException(
				"You don't have permission to set the room name.",
				HttpStatus.FORBIDDEN,
			);
		}

		if (authEventIds.length < 3) {
			logger.error(
				`Could not find all auth events for room name update. Found: ${JSON.stringify(authEventIds)}`,
			);
			throw new HttpException(
				'Not authorized or missing prerequisites to set room name',
				HttpStatus.FORBIDDEN,
			);
		}

		const authEvents: RoomNameAuthEvents = {
			'm.room.create':
				authEventIds.find((e) => e.type === EventType.CREATE)?._id || '',
			'm.room.power_levels': powerLevelsEventId || '',
			'm.room.member':
				authEventIds.find((e) => e.type === EventType.MEMBER)?._id || '',
		};

		if (!authEvents['m.room.create'] || !authEvents['m.room.member']) {
			// power_levels already checked
			logger.error(
				`Critical auth events missing (create or member). Create: ${authEvents['m.room.create']}, Member: ${authEvents['m.room.member']}`,
			);
			throw new HttpException(
				'Critical auth events missing, cannot set room name',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const roomNameEventPayload = {
			roomId,
			sender: senderId,
			auth_events: authEvents,
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			content: { name },
			origin: this.configService.getServerConfig().name,
		};

		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey = Array.isArray(signingKeyConfig)
			? signingKeyConfig[0]
			: signingKeyConfig;
		const serverName = this.configService.getServerConfig().name;

		const unsignedEvent = roomNameEvent(roomNameEventPayload);
		const signedEvent = await signEvent(unsignedEvent, signingKey, serverName);

		const eventId = generateId(signedEvent);
		await this.eventService.insertEvent(signedEvent, eventId);
		logger.info(
			`Successfully created and stored m.room.name event ${eventId} for room ${roomId}`,
		);

		await this.roomRepository.updateRoomName(roomId, name);
		logger.info(
			`Successfully updated room name in repository for room ${roomId}`,
		);

		for (const server of [targetServer]) {
			try {
				await this.federationService.sendEvent(
					server,
					signedEvent as unknown as EventBase,
				);
				logger.info(
					`Successfully sent m.room.name event ${eventId} over federation to ${server} for room ${roomId}`,
				);
			} catch (error) {
				logger.error(
					`Failed to send m.room.name event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return {
			eventId: eventId,
		};
	}

	async updateUserPowerLevel(
		roomId: string,
		userId: string,
		powerLevel: number,
		senderId: string,
		targetServers: string[] = [],
	): Promise<string> {
		logger.info(
			`Updating power level for user ${userId} in room ${roomId} to ${powerLevel} by ${senderId}`,
		);

		const authEventIds = await this.eventService.getAuthEventIds(
			EventType.POWER_LEVELS,
			{ roomId, senderId },
		);
		const currentPowerLevelsEvent =
			await this.eventService.getEventById<RoomPowerLevelsEvent>(
				authEventIds.find((e) => e.type === EventType.POWER_LEVELS)?._id || '',
			);

		if (!currentPowerLevelsEvent) {
			logger.error(`No m.room.power_levels event found for room ${roomId}`);
			throw new HttpException(
				'Room power levels not found, cannot update.',
				HttpStatus.NOT_FOUND,
			);
		}

		this.validatePowerLevelChange(
			currentPowerLevelsEvent.content,
			senderId,
			userId,
			powerLevel,
		);

		const createAuthResult = authEventIds.find(
			(e) => e.type === EventType.CREATE,
		);
		const powerLevelsAuthResult = authEventIds.find(
			(e) => e.type === EventType.POWER_LEVELS,
		);
		const memberAuthResult = authEventIds.find(
			(e) => e.type === EventType.MEMBER && e.state_key === senderId,
		);

		const authEventsMap = {
			'm.room.create': createAuthResult?._id || '',
			'm.room.power_levels': powerLevelsAuthResult?._id || '',
			'm.room.member': memberAuthResult?._id || '',
		};

		// Ensure critical auth events were found
		if (
			!authEventsMap['m.room.create'] ||
			!authEventsMap['m.room.power_levels'] ||
			!authEventsMap['m.room.member']
		) {
			logger.error(
				`Critical auth events missing for power level update. Create: ${authEventsMap['m.room.create']}, PowerLevels: ${authEventsMap['m.room.power_levels']}, Member: ${authEventsMap['m.room.member']}`,
			);
			throw new HttpException(
				'Internal server error: Missing auth events for power level update.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const lastEventStore = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEventStore) {
			logger.error(`No last event found for room ${roomId}`);
			throw new HttpException(
				'Room has no history, cannot update power levels',
				HttpStatus.BAD_REQUEST,
			);
		}

		const serverName = this.configService.getServerConfig().name;
		if (!serverName) {
			logger.error('Server name is not configured. Cannot set event origin.');
			throw new HttpException(
				'Server configuration error for event origin.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const eventToSign = roomPowerLevelsEvent({
			roomId,
			members: [senderId, userId],
			auth_events: Object.values(authEventsMap).filter(
				(id) => typeof id === 'string',
			),
			prev_events: [lastEventStore.event.event_id!],
			depth: lastEventStore.event.depth + 1,
			content: {
				...currentPowerLevelsEvent.content,
				users: {
					...(currentPowerLevelsEvent.content.users || {}),
					[userId]: powerLevel,
				},
			},
			ts: Date.now(),
		});

		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey: SigningKey = Array.isArray(signingKeyConfig)
			? signingKeyConfig[0]
			: signingKeyConfig;

		const signedEvent: SignedEvent<RoomPowerLevelsEvent> = await signEvent(
			eventToSign,
			signingKey,
			serverName,
		);

		const eventId = generateId(signedEvent);

		// Store the event locally BEFORE attempting federation
		await this.eventService.insertEvent(signedEvent, eventId);
		logger.info(
			`Successfully created and stored m.room.power_levels event ${eventId} for room ${roomId}`,
		);

		for (const server of targetServers) {
			if (server === this.configService.getServerConfig().name) {
				continue;
			}

			try {
				await this.federationService.sendEvent(server, signedEvent);
				logger.info(
					`Successfully sent m.room.power_levels event ${eventId} over federation to ${server} for room ${roomId}`,
				);
			} catch (error) {
				logger.error(
					`Failed to send m.room.power_levels event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return eventId;
	}

	async leaveRoom(roomId: string, senderId: string): Promise<string> {
		logger.info(`User ${senderId} leaving room ${roomId}`);

		// Get room information needed for the membership event
		const roomInformation = await this.stateService.getRoomInformation(roomId);

		// Check if user has permission to leave (send m.room.member events)
		const authEventIds = await this.eventService.getAuthEventIds(
			EventType.MEMBER,
			{ roomId, senderId },
		);

		const powerLevelsEventId = authEventIds.find(
			(e) => e.type === EventType.POWER_LEVELS,
		)?._id;
		if (!powerLevelsEventId) {
			logger.warn(
				`No power_levels event found for room ${roomId}, cannot verify permission to leave.`,
			);
			throw new HttpException(
				'Cannot verify permission to leave room.',
				HttpStatus.FORBIDDEN,
			);
		}

		const canLeaveRoom = await this.eventService.checkUserPermission(
			powerLevelsEventId,
			senderId,
			EventType.MEMBER,
		);

		if (!canLeaveRoom) {
			logger.warn(
				`User ${senderId} does not have permission to send m.room.member events in ${roomId} (i.e., to leave).`,
			);
			throw new HttpException(
				"You don't have permission to leave this room.",
				HttpStatus.FORBIDDEN,
			);
		}

		// Create the leave event using PersistentEventFactory
		const leaveEvent = PersistentEventFactory.newMembershipEvent(
			roomId,
			senderId,
			senderId, // state_key is the same as sender for leave
			'leave',
			roomInformation,
		);

		// Add auth and prev events
		await this.stateService.addAuthEvents(leaveEvent);
		await this.stateService.addPrevEvents(leaveEvent);

		// Sign the event
		await this.stateService.signEvent(leaveEvent);

		// Persist as state event (membership events are state events)
		await this.stateService.persistStateEvent(leaveEvent);
		if (leaveEvent.rejected) {
			throw new HttpException(
				leaveEvent.rejectedReason || 'Leave event was rejected',
				HttpStatus.BAD_REQUEST,
			);
		}

		// Send to other servers
		await this.federationService.sendEventToAllServersInRoom(leaveEvent);

		logger.info(
			`Successfully created and stored m.room.member (leave) event ${leaveEvent.eventId} for user ${senderId} in room ${roomId}`,
		);

		return leaveEvent.eventId;
	}

	async kickUser(
		roomId: string,
		kickedUserId: string,
		senderId: string,
		reason?: string,
	): Promise<string> {
		logger.info(
			`User ${senderId} kicking user ${kickedUserId} from room ${roomId}. Reason: ${reason || 'No reason specified'}`,
		);

		// Get room information needed for the membership event
		const roomInformation = await this.stateService.getRoomInformation(roomId);

		// Check kick permissions
		const authEventIdsForPowerLevels = await this.eventService.getAuthEventIds(
			EventType.POWER_LEVELS,
			{ roomId, senderId },
		);
		const powerLevelsEventId = authEventIdsForPowerLevels.find(
			(e) => e.type === EventType.POWER_LEVELS,
		)?._id;

		if (!powerLevelsEventId) {
			logger.warn(
				`No power_levels event found for room ${roomId}, cannot verify permission to kick.`,
			);
			throw new HttpException(
				'Cannot verify permission to kick user.',
				HttpStatus.FORBIDDEN,
			);
		}
		const powerLevelsEvent =
			await this.eventService.getEventById<RoomPowerLevelsEvent>(
				powerLevelsEventId,
			);
		if (!powerLevelsEvent) {
			logger.error(
				`Power levels event ${powerLevelsEventId} not found despite ID being retrieved.`,
			);
			throw new HttpException(
				'Internal server error: Power levels event data missing.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		this.validateKickPermission(
			powerLevelsEvent.content,
			senderId,
			kickedUserId,
		);

		// Create the kick event using PersistentEventFactory
		const kickEvent = PersistentEventFactory.newMembershipEvent(
			roomId,
			senderId,
			kickedUserId, // state_key is the kicked user
			'leave',
			roomInformation,
		);

		// Add reason to the event content if provided
		if (reason) {
			(kickEvent.event.content as any).reason = reason;
		}

		// Add auth and prev events
		await this.stateService.addAuthEvents(kickEvent);
		await this.stateService.addPrevEvents(kickEvent);

		// Sign the event
		await this.stateService.signEvent(kickEvent);

		// Persist as state event (membership events are state events)
		await this.stateService.persistStateEvent(kickEvent);
		if (kickEvent.rejected) {
			throw new HttpException(
				kickEvent.rejectedReason || 'Kick event was rejected',
				HttpStatus.BAD_REQUEST,
			);
		}

		// Send to other servers
		await this.federationService.sendEventToAllServersInRoom(kickEvent);

		logger.info(
			`Successfully created and stored m.room.member (kick) event ${kickEvent.eventId} for user ${kickedUserId} in room ${roomId}`,
		);

		return kickEvent.eventId;
	}

	async banUser(
		roomId: string,
		bannedUserId: string,
		senderId: string,
		reason?: string,
		targetServers: string[] = [],
	): Promise<string> {
		logger.info(
			`User ${senderId} banning user ${bannedUserId} from room ${roomId}. Reason: ${reason || 'No reason specified'}`,
		);

		const lastEvent = await this.eventService.getLastEventForRoom(roomId);
		if (!lastEvent) {
			throw new HttpException(
				'Room has no history, cannot ban user',
				HttpStatus.BAD_REQUEST,
			);
		}

		const authEventIdsForPowerLevels = await this.eventService.getAuthEventIds(
			EventType.POWER_LEVELS,
			{ roomId, senderId },
		);
		const powerLevelsEventId = authEventIdsForPowerLevels.find(
			(e) => e.type === EventType.POWER_LEVELS,
		)?._id;

		if (!powerLevelsEventId) {
			logger.warn(
				`No power_levels event found for room ${roomId}, cannot verify permission to ban.`,
			);
			throw new HttpException(
				'Cannot verify permission to ban user.',
				HttpStatus.FORBIDDEN,
			);
		}
		const powerLevelsEvent =
			await this.eventService.getEventById<RoomPowerLevelsEvent>(
				powerLevelsEventId,
			);
		if (!powerLevelsEvent) {
			logger.error(
				`Power levels event ${powerLevelsEventId} not found despite ID being retrieved.`,
			);
			throw new HttpException(
				'Internal server error: Power levels event data missing.',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		this.validateBanPermission(
			powerLevelsEvent.content,
			senderId,
			bannedUserId,
		);

		const authEventIdsForMemberEvent = await this.eventService.getAuthEventIds(
			EventType.MEMBER,
			{ roomId, senderId },
		);
		const createEventId = authEventIdsForMemberEvent.find(
			(e) => e.type === EventType.CREATE,
		)?._id;
		const senderMemberEventId = authEventIdsForMemberEvent.find(
			(e) => e.type === EventType.MEMBER && e.state_key === senderId,
		)?._id;

		if (!createEventId || !senderMemberEventId || !powerLevelsEventId) {
			logger.error(
				`Critical auth events missing for ban. Create: ${createEventId}, Sender's Member: ${senderMemberEventId}, PowerLevels: ${powerLevelsEventId}`,
			);
			throw new HttpException(
				'Critical auth events missing, cannot ban user',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		const authEvents = {
			'm.room.create': createEventId,
			'm.room.power_levels': powerLevelsEventId,
			[`m.room.member:${bannedUserId}`]: senderMemberEventId,
		};

		const serverName = this.configService.getServerConfig().name;
		const signingKeyConfig = await this.configService.getSigningKey();
		const signingKey: SigningKey = Array.isArray(signingKeyConfig)
			? signingKeyConfig[0]
			: signingKeyConfig;

		const unsignedEvent = roomMemberEvent({
			roomId,
			sender: senderId,
			state_key: bannedUserId,
			auth_events: authEvents,
			prev_events: [lastEvent._id],
			depth: lastEvent.event.depth + 1,
			membership: 'ban',
			origin: serverName,
			content: {
				membership: 'ban',
				...(reason ? { reason } : {}),
			},
		});

		const signedEvent = await signEvent(unsignedEvent, signingKey, serverName);
		const eventId = generateId(signedEvent);

		await this.eventService.insertEvent(signedEvent, eventId);
		logger.info(
			`Successfully created and stored m.room.member (ban) event ${eventId} for user ${bannedUserId} in room ${roomId}`,
		);

		for (const server of targetServers) {
			if (server === serverName) {
				continue;
			}
			try {
				await this.federationService.sendEvent(server, signedEvent);
				logger.info(
					`Successfully sent m.room.member (ban) event ${eventId} over federation to ${server} for room ${roomId}`,
				);
			} catch (error) {
				logger.error(
					`Failed to send m.room.member (ban) event ${eventId} over federation to ${server}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		return eventId;
	}

	// if local room, add the user to the room if allowed.
	// if remote room, run through the join process
	async joinUser(roomId: string, userId: string) {
		const configService = this.configService;
		const stateService = this.stateService;
		const federationService = this.federationService;

		// where the room is hosted at
		const residentServer = roomId.split(':').pop();

		// our own room, we can validate the join event by ourselves
		// once done, emit the event to all participating servers
		if (residentServer === configService.getServerName()) {
			const room = await stateService.getFullRoomState(roomId);

			const createEvent = room.get('m.room.create:');

			if (!createEvent) {
				throw new Error(
					'Room create event not found when trying to join a room',
				);
			}

			const membershipEvent = PersistentEventFactory.newMembershipEvent(
				roomId,
				userId, // sender and state_key are the same for join events
				userId,
				'join',
				createEvent.getContent(),
			);

			await stateService.addAuthEvents(membershipEvent);

			await stateService.addPrevEvents(membershipEvent);

			await stateService.persistStateEvent(membershipEvent);

			if (membershipEvent.rejected) {
				throw new Error(membershipEvent.rejectedReason);
			}

			void federationService.sendEventToAllServersInRoom(membershipEvent);

			return membershipEvent.eventId;
		}

		const roomVersion = '10' as const;

		// trying to join room from another server
		const makeJoinResponse = await federationService.makeJoin(
			residentServer as string,
			roomId,
			userId,
			roomVersion, // NOTE: check the comment in the called method
		);

		// ^ have the template for the join event now

		const joinEvent = PersistentEventFactory.createFromRawEvent(
			makeJoinResponse.event as any, // TODO: using room package types will take care of this
			makeJoinResponse.room_version,
		);

		// const signedJoinEvent = await stateService.signEvent(joinEvent);

		// TODO: sign the event here vvv
		// currently makeSignedRequest does the signing
		const sendJoinResponse = await federationService.sendJoin(joinEvent);

		// TODO: validate hash and sig (item 2)

		// run through state res
		// validate all auth chain events
		const eventMap = new Map<string, PersistentEventBase>();

		for (const stateEvent_ of sendJoinResponse.state) {
			const stateEvent = PersistentEventFactory.createFromRawEvent(
				stateEvent_ as any,
				makeJoinResponse.room_version,
			);

			eventMap.set(stateEvent.eventId, stateEvent);
		}

		for (const authEvent_ of sendJoinResponse.auth_chain) {
			const authEvent = PersistentEventFactory.createFromRawEvent(
				authEvent_ as any,
				makeJoinResponse.room_version,
			);
			eventMap.set(authEvent.eventId, authEvent);
		}

		// TODO: 1 room version handling, related to request type
		// TODO: 2 have state service do this or not modify our event
		const copyEvent = (event: Readonly<PersistentEventBase>) => {
			return PersistentEventFactory.createFromRawEvent(
				structuredClone(event.event),
				roomVersion,
			);
		};

		const persisted = new Set<string>();

		// persistEvent walks auth_events, and recursively calls itself with each auth event
		// persists until it reaches the first event it was called with.
		// makes sure all auth events are persisted before the state event
		const persistEvent = async (event: Readonly<PersistentEventBase>) => {
			if (!persisted.has(event.eventId) && event.isCreateEvent()) {
				// persist as normal, m.room.create :)
				logger.info(
					`Persisting create event ${event.eventId}, ${JSON.stringify(
						event.event,
						null,
						2,
					)}`,
				);

				const eventToPersist = copyEvent(event);

				await stateService.persistStateEvent(eventToPersist);

				persisted.add(event.eventId);

				return;
			}

			for (const authEventId of event.event.auth_events) {
				const authEvent = eventMap.get(authEventId as string);
				if (!authEvent) {
					for (const stateEvent of eventMap.keys()) {
						console.log(
							`${stateEvent} -> ${JSON.stringify(eventMap.get(stateEvent)?.event, null, 2)}`,
						);
					}
					throw new Error(`Auth event ${authEventId} not found`);
				}

				if (!persisted.has(authEventId as string)) {
					// persist all the auth events of this authEvent
					logger.info(
						`Persisting auth event ${authEventId} because not persisted already, ${JSON.stringify(
							authEvent.event,
							null,
							2,
						)}`,
					);

					// recursively persist this and all it's auth events
					await persistEvent(authEvent); // pl

					persisted.add(authEvent.eventId);
				}
			}

			// ^^ all auth events of this event have been persisted

			// persist as normal
			logger.info(
				`Persisting state event after auth events have been persisted, ${event.eventId}, ${JSON.stringify(
					event.event,
					null,
					2,
				)}`,
			);

			const eventToPersist = copyEvent(event);

			await stateService.persistStateEvent(eventToPersist);

			persisted.add(event.eventId);
		};

		for (const stateEvent of eventMap.values()) {
			if (persisted.has(stateEvent.eventId)) {
				continue;
			}

			logger.info(
				`Persisting state event ${stateEvent.eventId}, ${JSON.stringify(
					stateEvent.event,
					null,
					2,
				)}`,
			);
			await persistEvent(stateEvent);
		}

		const joinEventFinal = PersistentEventFactory.createFromRawEvent(
			sendJoinResponse.event as any,
			makeJoinResponse.room_version,
		);

		logger.info(
			`Persisting join event ${joinEventFinal.eventId}, ${JSON.stringify(
				joinEventFinal.event,
				null,
				2,
			)}`,
		);

		const state = await stateService.getFullRoomState(roomId);

		logger.info(
			`State before join event has been persisted, ${state.keys().toArray().join(', ')}`,
		);

		// try to persist the join event now, should succeed with state in place
		await stateService.persistStateEvent(joinEventFinal);

		if (joinEventFinal.rejected) {
			throw new Error(joinEventFinal.rejectedReason);
		}

		return joinEventFinal.eventId;
	}

	async markRoomAsTombstone(
		roomId: string,
		sender: string,
		reason = 'This room has been deleted',
		replacementRoomId?: string,
	): Promise<SignedEvent<RoomTombstoneEvent>> {
		logger.debug(`Marking room ${roomId} as tombstone by ${sender}`);
		const config = this.configService.getServerConfig();
		const signingKey = await this.configService.getSigningKey();

		const room = await this.roomRepository.findOneById(roomId);
		if (!room) {
			throw new HttpException('Room not found', HttpStatus.NOT_FOUND);
		}
		const isTombstoned = await this.isRoomTombstoned(roomId);
		if (isTombstoned) {
			logger.warn(`Attempted to delete an already tombstoned room: ${roomId}`);
			throw new ForbiddenError('Cannot delete an already tombstoned room');
		}
		if (sender.split(':').pop() !== config.name) {
			throw new HttpException('Invalid sender', HttpStatus.BAD_REQUEST);
		}

		const powerLevelsEvent =
			await this.eventRepository.findPowerLevelsEventByRoomId(roomId);
		if (!powerLevelsEvent) {
			throw new HttpException(
				'Cannot delete room without power levels',
				HttpStatus.FORBIDDEN,
			);
		}

		if (!isRoomPowerLevelsEvent(powerLevelsEvent.event)) {
			throw new HttpException(
				'Invalid power levels event',
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		this.validatePowerLevelForTombstone(powerLevelsEvent.event, sender);

		const authEvents = await this.eventService.getAuthEventIds(
			EventType.MESSAGE,
			{
				roomId,
				senderId: sender,
			},
		);
		const latestEvent = await this.eventService.getLastEventForRoom(roomId);
		const currentDepth = latestEvent?.event?.depth ?? 0;
		const depth = currentDepth + 1;

		const authEventsMap: TombstoneAuthEvents = {
			'm.room.create':
				authEvents.find(
					(event: { type: EventType }) => event.type === EventType.CREATE,
				)?._id || '',
			'm.room.power_levels':
				authEvents.find(
					(event: { type: EventType }) => event.type === EventType.POWER_LEVELS,
				)?._id || '',
			'm.room.member':
				authEvents.find(
					(event: { type: EventType }) => event.type === EventType.MEMBER,
				)?._id || '',
		};
		const prevEvents = latestEvent ? [latestEvent._id] : [];

		const tombstoneEvent = roomTombstoneEvent({
			roomId,
			sender,
			body: reason,
			replacementRoom: replacementRoomId,
			auth_events: authEventsMap,
			prev_events: prevEvents,
			depth,
			origin: config.name,
		});

		const signedEvent = await signEvent(
			tombstoneEvent,
			Array.isArray(signingKey) ? signingKey[0] : signingKey,
			config.name,
		);

		const eventId = await this.eventService.insertEvent(signedEvent);
		await this.roomRepository.markRoomAsDeleted(roomId, eventId);

		await this.notifyFederatedServersAboutTombstone(roomId, signedEvent);
		logger.info(`Successfully marked room ${roomId} as tombstone`);

		return signedEvent;
	}

	public async isRoomTombstoned(roomId: string): Promise<boolean> {
		try {
			const room = await this.roomRepository.findOneById(roomId);
			if (room?.room.deleted) {
				logger.debug(
					`Room ${roomId} is marked as deleted in the room repository`,
				);
				return true;
			}

			const tombstoneEvents = await this.eventService.findEvents(
				{
					'event.room_id': roomId,
					'event.type': 'm.room.tombstone',
					'event.state_key': '',
				},
				{ limit: 1 },
			);

			return tombstoneEvents.length > 0;
		} catch (error) {
			logger.error(`Error checking if room ${roomId} is tombstoned: ${error}`);
			return false;
		}
	}

	private validatePowerLevelForTombstone(
		powerLevels: RoomPowerLevelsEvent,
		sender: string,
	): void {
		const userPowerLevel =
			powerLevels.content.users?.[sender] ??
			powerLevels.content.users_default ??
			0;
		const requiredPowerLevel = powerLevels.content.state_default ?? 50;

		if (userPowerLevel < requiredPowerLevel) {
			throw new HttpException(
				'Insufficient power level to delete room',
				HttpStatus.FORBIDDEN,
			);
		}
	}

	private async notifyFederatedServersAboutTombstone(
		roomId: string,
		signedEvent: SignedEvent<RoomTombstoneEvent>,
	): Promise<void> {
		const config = this.configService.getServerConfig();
		const memberEvents =
			await this.eventRepository.findAllJoinedMembersEventsByRoomId(roomId);
		const remoteServers = new Set<string>();

		for (const event of memberEvents) {
			if (event.event.state_key) {
				const serverName = event.event.state_key.split(':').pop();
				if (serverName && serverName !== config.name) {
					remoteServers.add(serverName);
				}
			}
		}

		const federationPromises = Array.from(remoteServers).map((server) => {
			logger.debug(
				`Sending tombstone event to server ${server} for room ${roomId}`,
			);
			return this.federationService.sendTombstone(server, signedEvent);
		});

		await Promise.all(federationPromises);
		logger.info(
			`Notified ${remoteServers.size} federated servers about room mark as tombstone`,
		);
	}
}
