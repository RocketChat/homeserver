import {
	EventBase,
	EventStore,
	RoomPowerLevelsEvent,
	SignedEvent,
	TombstoneAuthEvents,
	roomPowerLevelsEvent,
} from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import { FederationService } from './federation.service';

import {
	ForbiddenError,
	HttpException,
	HttpStatus,
} from '@rocket.chat/federation-core';

import { logger } from '@rocket.chat/federation-core';
import {
	type EventID,
	PduForType,
	PduJoinRuleEventContent,
	PduType,
	PersistentEventBase,
	PersistentEventFactory,
	RoomID,
	RoomVersion,
	UserID,
} from '@rocket.chat/federation-room';
import { EventRepository } from '../repositories/event.repository';
import { RoomRepository } from '../repositories/room.repository';
import { ConfigService } from './config.service';
import { EventService } from './event.service';

import { EventEmitterService } from './event-emitter.service';
import { InviteService } from './invite.service';
import { StateService } from './state.service';

@singleton()
export class RoomService {
	constructor(
		private readonly roomRepository: RoomRepository,
		private readonly eventRepository: EventRepository,
		private readonly eventService: EventService,
		private readonly configService: ConfigService,
		private readonly federationService: FederationService,
		private readonly stateService: StateService,
		private readonly inviteService: InviteService,
		private readonly eventEmitterService: EventEmitterService,
	) {}

	private validatePowerLevelChange(
		currentPowerLevelsContent: PduForType<'m.room.power_levels'>['content'],
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
			logger.info({ msg: 'Successfully upserted room', roomId });
		} catch (error) {
			logger.error({ msg: 'Failed to upsert room', roomId, err: error });
			throw error;
		}
	}

	/**
	 * Create a new room with the given sender and username
	 */
	async createRoom(
		username: UserID,
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

		await stateService.signEvent(roomCreateEvent);

		await stateService.handlePdu(roomCreateEvent);

		const creatorMembershipEvent =
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: { membership: 'join' },
					room_id: roomCreateEvent.roomId,
					state_key: username,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: username,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(creatorMembershipEvent);

		const roomNameEvent = await stateService.buildEvent<'m.room.name'>(
			{
				type: 'm.room.name',
				content: { name: name },
				room_id: roomCreateEvent.roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: username,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.handlePdu(roomNameEvent);

		const powerLevelEvent =
			await stateService.buildEvent<'m.room.power_levels'>(
				{
					type: 'm.room.power_levels',
					content: {
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
					room_id: roomCreateEvent.roomId,
					state_key: '',
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: username,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(powerLevelEvent);

		const joinRuleEvent = await stateService.buildEvent<'m.room.join_rules'>(
			{
				type: 'm.room.join_rules',
				content: { join_rule: joinRule },
				room_id: roomCreateEvent.roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: username,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.handlePdu(joinRuleEvent);

		const canonicalAliasEvent =
			await stateService.buildEvent<'m.room.canonical_alias'>(
				{
					type: 'm.room.canonical_alias',
					content: {
						alias: `#${name}:${this.configService.serverName}`,
						alt_aliases: [],
					},
					room_id: roomCreateEvent.roomId,
					state_key: '',
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: username,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(canonicalAliasEvent);

		return {
			room_id: roomCreateEvent.roomId,
			event_id: roomCreateEvent.eventId,
		};
	}

	async updateRoomName(roomId: RoomID, name: string, senderId: UserID) {
		logger.info(
			`Updating room name for ${roomId} to \"${name}\" by ${senderId}`,
		);

		const roomversion = await this.stateService.getRoomVersion(roomId);
		if (!roomversion) {
			throw new Error('Room version not found');
		}
		const stateService = this.stateService;

		const roomNameEvent = await stateService.buildEvent<'m.room.name'>(
			{
				type: 'm.room.name',
				content: { name },
				room_id: roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderId,
			},
			roomversion,
		);

		await stateService.handlePdu(roomNameEvent);

		void this.federationService.sendEventToAllServersInRoom(roomNameEvent);

		return roomNameEvent;
	}

	async setRoomTopic(roomId: RoomID, sender: UserID, topic: string) {
		const roomVersion = await this.stateService.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error('Room version not found while setting room topic');
		}

		const topicEvent = await this.stateService.buildEvent<'m.room.topic'>(
			{
				type: 'm.room.topic',
				content: { topic },
				room_id: roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: sender,
			},
			roomVersion,
		);

		await this.stateService.handlePdu(topicEvent);

		void this.federationService.sendEventToAllServersInRoom(topicEvent);
	}

	private getEventByType<E extends PduType>(
		authEventIds: EventStore[],
		type: E,
		extra?: (event: EventStore<PduForType<E>>) => boolean,
	): EventStore<PduForType<E>> | undefined {
		const event = authEventIds.find(
			(e) =>
				e.event.type === type &&
				(!extra || extra(e as unknown as EventStore<PduForType<E>>)),
		);
		return event as unknown as EventStore<PduForType<E>> | undefined;
	}

	async updateUserPowerLevel(
		roomId: RoomID,
		userId: UserID,
		powerLevel: number,
		senderId: UserID,
	): Promise<string> {
		logger.info(
			`Updating power level for user ${userId} in room ${roomId} to ${powerLevel} by ${senderId}`,
		);

		const authEventIds = await this.eventService.getAuthEventIds(
			'm.room.power_levels',
			{ roomId, senderId },
		);

		const powerLevelsAuthResult = this.getEventByType(
			authEventIds,
			'm.room.power_levels',
		);

		const currentPowerLevelsEvent =
			powerLevelsAuthResult?._id &&
			(await this.eventService.getEventById(
				powerLevelsAuthResult._id,
				'm.room.power_levels',
			));

		if (!currentPowerLevelsEvent) {
			logger.error(`No m.room.power_levels event found for room ${roomId}`);
			throw new HttpException(
				'Room power levels not found, cannot update.',
				HttpStatus.NOT_FOUND,
			);
		}

		this.validatePowerLevelChange(
			currentPowerLevelsEvent.event.content,
			senderId,
			userId,
			powerLevel,
		);

		const createAuthResult = this.getEventByType(authEventIds, 'm.room.create');

		const memberAuthResult = this.getEventByType(
			authEventIds,
			'm.room.member',
			(e) => e.event.state_key === senderId,
		);

		// Ensure critical auth events were found
		if (!createAuthResult || !powerLevelsAuthResult || !memberAuthResult) {
			logger.error(
				`Critical auth events missing for power level update. Create: ${
					createAuthResult?._id ?? 'missing'
				}, PowerLevels: ${powerLevelsAuthResult?._id ?? 'missing'}, Member: ${
					memberAuthResult?._id ?? 'missing'
				}`,
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

		const serverName = this.configService.serverName;
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
			auth_events: {
				'm.room.create': createAuthResult._id,
				'm.room.power_levels': powerLevelsAuthResult._id,
				'm.room.member': memberAuthResult._id,
			},
			prev_events: lastEventStore._id ? [lastEventStore._id] : [],
			depth: lastEventStore.event.depth + 1,
			content: {
				...currentPowerLevelsEvent.event.content,
				users: {
					...(currentPowerLevelsEvent.event.content.users || {}),
					[userId]: powerLevel,
				},
			},
			ts: Date.now(),
		}) as PduForType<'m.room.power_levels'>;

		const event = await this.stateService.buildEvent<'m.room.power_levels'>(
			{
				type: 'm.room.power_levels',
				content: eventToSign.content,
				room_id: roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: eventToSign.sender,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await this.stateService.handlePdu(event);

		logger.info(
			`Successfully created and stored m.room.power_levels event ${event.eventId} for room ${roomId}`,
		);

		void this.federationService.sendEventToAllServersInRoom(event);

		return event.eventId;
	}

	async leaveRoom(roomId: RoomID, senderId: UserID): Promise<EventID> {
		logger.info(`User ${senderId} leaving room ${roomId}`);

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const authEventIds = await this.eventService.getAuthEventIds(
			'm.room.member',
			{ roomId, senderId },
		);

		// For a leave event, the user must have permission to send m.room.member events.
		// This is typically covered by them being a member, but power levels might restrict it.
		const powerLevelsEventId = this.getEventByType(
			authEventIds,
			'm.room.power_levels',
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
			'm.room.member',
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

		const leaveEvent = await this.stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: { membership: 'leave' },
				room_id: roomId,
				state_key: senderId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderId,
			},
			roomInfo.room_version,
		);

		await this.stateService.handlePdu(leaveEvent);

		logger.info(
			`Successfully created and stored m.room.member (leave) event ${leaveEvent.eventId} for user ${senderId} in room ${roomId}`,
		);

		void this.federationService.sendEventToAllServersInRoom(leaveEvent);

		return leaveEvent.eventId;
	}

	async kickUser(
		roomId: RoomID,
		kickedUserId: UserID,
		senderId: UserID,
		reason?: string,
	): Promise<EventID> {
		logger.info(
			`User ${senderId} kicking user ${kickedUserId} from room ${roomId}. Reason: ${
				reason || 'No reason specified'
			}`,
		);

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const authEventIdsForPowerLevels = await this.eventService.getAuthEventIds(
			'm.room.power_levels',
			{ roomId, senderId },
		);
		const powerLevelsEventId = this.getEventByType(
			authEventIdsForPowerLevels,
			'm.room.power_levels',
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
		const powerLevelsEvent = await this.eventService.getEventById(
			powerLevelsEventId,
			'm.room.power_levels',
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
			powerLevelsEvent.event.content,
			senderId,
			kickedUserId,
		);

		const kickEvent = await this.stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: {
					membership: 'leave',
					reason: reason,
				},
				room_id: roomId,
				state_key: kickedUserId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderId,
			},
			roomInfo.room_version,
		);

		await this.stateService.handlePdu(kickEvent);

		logger.info(
			`Successfully created and stored m.room.member (kick) event ${kickEvent.eventId} for user ${kickedUserId} in room ${roomId}`,
		);

		void this.federationService.sendEventToAllServersInRoom(kickEvent);

		return kickEvent.eventId;
	}

	async banUser(
		roomId: RoomID,
		bannedUserId: UserID,
		senderId: UserID,
		reason?: string,
	): Promise<EventID> {
		logger.info(
			`User ${senderId} banning user ${bannedUserId} from room ${roomId}. Reason: ${
				reason || 'No reason specified'
			}`,
		);

		const roomInfo = await this.stateService.getRoomInformation(roomId);

		const authEventIdsForPowerLevels = await this.eventService.getAuthEventIds(
			'm.room.power_levels',
			{ roomId, senderId },
		);

		const powerLevelsEventId = this.getEventByType(
			authEventIdsForPowerLevels,
			'm.room.power_levels',
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
		const powerLevelsEvent = await this.eventService.getEventById(
			powerLevelsEventId,
			'm.room.power_levels',
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
			powerLevelsEvent.event.content,
			senderId,
			bannedUserId,
		);

		const banEvent = await this.stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: {
					membership: 'ban',
					reason: reason,
				},
				room_id: roomId,
				state_key: bannedUserId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: senderId,
			},
			roomInfo.room_version,
		);

		await this.stateService.handlePdu(banEvent);

		logger.info(
			`Successfully created and stored m.room.member (ban) event ${banEvent.eventId} for user ${bannedUserId} in room ${roomId}`,
		);

		void this.federationService.sendEventToAllServersInRoom(banEvent);

		return banEvent.eventId;
	}

	// if local room, add the user to the room if allowed.
	// if remote room, run through the join process
	async joinUser(roomId: RoomID, userId: UserID) {
		const configService = this.configService;
		const stateService = this.stateService;
		const federationService = this.federationService;

		// where the room is hosted at
		const residentServer = roomId.split(':').pop();

		// our own room, we can validate the join event by ourselves
		// once done, emit the event to all participating servers
		if (residentServer === configService.serverName) {
			const room = await stateService.getLatestRoomState(roomId);

			const createEvent = room.get('m.room.create:');

			if (!createEvent) {
				throw new Error(
					'Room create event not found when trying to join a room',
				);
			}

			const membershipEvent = await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: { membership: 'join' },
					room_id: roomId,
					state_key: userId,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: userId,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

			await stateService.handlePdu(membershipEvent);

			this.eventEmitterService.emit('homeserver.matrix.membership', {
				event_id: membershipEvent.eventId,
				event: membershipEvent.event,
				room_id: roomId,
				state_key: userId,
				content: { membership: 'join' },
				sender: userId,
				origin_server_ts: Date.now(),
			});

			if (membershipEvent.rejected) {
				throw new Error(membershipEvent.rejectReason);
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
			makeJoinResponse.event as unknown as Parameters<
				typeof PersistentEventFactory.createFromRawEvent
			>[0], // TODO: using room package types will take care of this
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
				stateEvent_ as unknown as Parameters<
					typeof PersistentEventFactory.createFromRawEvent
				>[0],
				makeJoinResponse.room_version,
			);

			eventMap.set(stateEvent.eventId, stateEvent);
		}

		for (const authEvent_ of sendJoinResponse.auth_chain) {
			const authEvent = PersistentEventFactory.createFromRawEvent(
				authEvent_ as unknown as Parameters<
					typeof PersistentEventFactory.createFromRawEvent
				>[0],
				makeJoinResponse.room_version,
			);
			eventMap.set(authEvent.eventId, authEvent);
		}

		const sorted = Array.from(eventMap.values()).sort((a, b) => {
			if (a.depth !== b.depth) {
				return a.depth - b.depth;
			}

			if (a.originServerTs !== b.originServerTs) {
				return a.originServerTs - b.originServerTs;
			}

			return a.eventId.localeCompare(b.eventId);
		});

		for (const event of sorted) {
			logger.debug({
				msg: 'Persisting event',
				eventId: event.eventId,
				event: event.event,
			});
			await stateService.handlePdu(event);
		}

		const joinEventFinal = PersistentEventFactory.createFromRawEvent(
			sendJoinResponse.event as unknown as Parameters<
				typeof PersistentEventFactory.createFromRawEvent
			>[0],
			makeJoinResponse.room_version,
		);

		logger.info({
			msg: 'Persisting join event',
			eventId: joinEventFinal.eventId,
			event: joinEventFinal.event,
		});

		const state = await stateService.getLatestRoomState(roomId);

		logger.info({
			msg: 'State before join event has been persisted',
			state: state.keys().toArray().join(', '),
		});

		// try to persist the join event now, should succeed with state in place
		await this.eventService.processIncomingPDUs(
			residentServer || joinEventFinal.origin,
			[joinEventFinal.event],
		);

		if (joinEventFinal.rejected) {
			throw new Error(joinEventFinal.rejectReason);
		}

		return joinEventFinal.eventId;
	}

	async markRoomAsTombstone(
		roomId: RoomID,
		sender: UserID,
		reason = 'This room has been deleted',
		replacementRoomId?: RoomID,
	): Promise<SignedEvent<PduForType<'m.room.tombstone'>>> {
		logger.debug(`Marking room ${roomId} as tombstone by ${sender}`);
		const serverName = this.configService.serverName;

		const room = await this.roomRepository.findOneById(roomId);
		if (!room) {
			throw new HttpException('Room not found', HttpStatus.NOT_FOUND);
		}
		const isTombstoned = await this.isRoomTombstoned(roomId);
		if (isTombstoned) {
			logger.warn(`Attempted to delete an already tombstoned room: ${roomId}`);
			throw new ForbiddenError('Cannot delete an already tombstoned room');
		}
		if (sender.split(':').pop() !== serverName) {
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

		this.validatePowerLevelForTombstone(powerLevelsEvent.event, sender);

		const authEvents = await this.eventService.getAuthEventIds(
			'm.room.message',
			{
				roomId,
				senderId: sender,
			},
		);
		const latestEvent = await this.eventService.getLastEventForRoom(roomId);
		const currentDepth = latestEvent?.event?.depth ?? 0;
		const depth = currentDepth + 1;

		const authEventsMap: TombstoneAuthEvents = {
			'm.room.create': authEvents.find(
				(event) => event.event.type === 'm.room.create',
			)?._id,
			'm.room.power_levels': authEvents.find(
				(event) => event.event.type === 'm.room.power_levels',
			)?._id,
			'm.room.member': authEvents.find(
				(event) => event.event.type === 'm.room.member',
			)?._id,
		};
		const prevEvents = latestEvent ? [latestEvent._id] : [];

		const authEventsArray = Object.values(authEventsMap).filter(
			(event) => event !== undefined,
		) as EventID[];

		const event = await this.stateService.buildEvent<'m.room.tombstone'>(
			{
				room_id: roomId,
				sender: sender,
				content: {
					body: reason,
					replacement_room: replacementRoomId,
				},
				auth_events: authEventsArray,
				prev_events: prevEvents,
				depth,
				origin_server_ts: Date.now(),
				unsigned: { age_ts: Date.now() },
				hashes: { sha256: '' },
				signatures: {},
				type: 'm.room.tombstone',
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		const _stateId = await this.stateService.handlePdu(event);

		await this.roomRepository.markRoomAsDeleted(roomId, event.eventId);

		void this.federationService.sendEventToAllServersInRoom(event);

		logger.info(`Successfully marked room ${roomId} as tombstone`);

		const { event: eventToReturn } = event;

		return {
			...eventToReturn,
			event_id: event.eventId,
		};
	}

	public async isRoomTombstoned(roomId: RoomID): Promise<boolean> {
		try {
			const room = await this.roomRepository.findOneById(roomId);
			if (room?.room.deleted) {
				logger.debug(
					`Room ${roomId} is marked as deleted in the room repository`,
				);
				return true;
			}

			const tombstoneEvents =
				this.eventRepository.findTombstoneEventsByRoomId(roomId);
			return (await tombstoneEvents.toArray()).length > 0;
		} catch (error) {
			logger.error({
				msg: 'Error checking if room is tombstoned',
				roomId,
				err: error,
			});
			return false;
		}
	}

	private validatePowerLevelForTombstone(
		powerLevels: PduForType<'m.room.power_levels'>,
		sender: UserID,
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

	async setPowerLevelForUser(
		roomId: RoomID,
		sender: UserID,
		userId: UserID,
		powerLevel: number,
	) {
		const state = await this.stateService.getLatestRoomState2(roomId);

		const existing = state.powerLevels;

		if (!existing) {
			// TODO we should have one always for ours
			throw new Error(
				'Power levels event not found while setting power level for user',
			);
		}

		const clone = structuredClone(existing);

		if (!clone?.users) {
			clone.users = {};
		}

		clone.users[userId] = powerLevel;

		const event = await this.stateService.buildEvent<'m.room.power_levels'>(
			{
				type: 'm.room.power_levels',
				content: clone,
				room_id: roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: sender,
			},
			state.version,
		);

		await this.stateService.handlePdu(event);

		void this.federationService.sendEventToAllServersInRoom(event);
	}

	async createDirectMessageRoom(
		creatorUserId: UserID,
		targetUserId: UserID,
	): Promise<RoomID> {
		logger.debug(
			`Creating direct message room between ${creatorUserId} and ${targetUserId}`,
		);

		const existingRoomId = await this.findExistingDirectMessageRoom(
			creatorUserId,
			targetUserId,
		);
		if (existingRoomId) {
			logger.debug(`Found existing DM room ${existingRoomId} between users`);
			return existingRoomId;
		}

		const targetServerName = targetUserId.split(':')[1];
		const localServerName = this.configService.serverName;
		const isExternalUser = targetServerName !== localServerName;

		const stateService = this.stateService;

		const roomCreateEvent = PersistentEventFactory.newCreateEvent(
			creatorUserId,
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.signEvent(roomCreateEvent);

		await stateService.handlePdu(roomCreateEvent);

		// Extract displayname from userId for direct messages
		const creatorDisplayname = creatorUserId.split(':').shift()?.slice(1);

		const creatorMembershipEvent =
			await stateService.buildEvent<'m.room.member'>(
				{
					type: 'm.room.member',
					content: {
						membership: 'join',
						is_direct: true,
						displayname: creatorDisplayname,
					},
					room_id: roomCreateEvent.roomId,
					state_key: creatorUserId,
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: creatorUserId,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(creatorMembershipEvent);

		const powerLevelsEvent =
			await stateService.buildEvent<'m.room.power_levels'>(
				{
					type: 'm.room.power_levels',
					content: {
						users: {
							[creatorUserId]: 50,
							[targetUserId]: 50,
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
					room_id: roomCreateEvent.roomId,
					state_key: '',
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: creatorUserId,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(powerLevelsEvent);

		const joinRulesEvent = await stateService.buildEvent<'m.room.join_rules'>(
			{
				type: 'm.room.join_rules',
				content: { join_rule: 'invite' },
				room_id: roomCreateEvent.roomId,
				state_key: '',
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: creatorUserId,
			},
			PersistentEventFactory.defaultRoomVersion,
		);

		await stateService.handlePdu(joinRulesEvent);

		const historyVisibilityEvent =
			await stateService.buildEvent<'m.room.history_visibility'>(
				{
					type: 'm.room.history_visibility',
					content: { history_visibility: 'shared' },
					room_id: roomCreateEvent.roomId,
					state_key: '',
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: creatorUserId,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(historyVisibilityEvent);

		const guestAccessEvent =
			await stateService.buildEvent<'m.room.guest_access'>(
				{
					type: 'm.room.guest_access',
					content: { guest_access: 'forbidden' },
					room_id: roomCreateEvent.roomId,
					state_key: '',
					auth_events: [],
					depth: 0,
					prev_events: [],
					origin_server_ts: Date.now(),
					sender: creatorUserId,
				},
				PersistentEventFactory.defaultRoomVersion,
			);

		await stateService.handlePdu(guestAccessEvent);

		if (isExternalUser) {
			await this.inviteService.inviteUserToRoom(
				targetUserId,
				roomCreateEvent.roomId,
				creatorUserId,
				true, // isDirectMessage
			);
		} else {
			// Extract displayname from userId for direct messages
			const displayname = targetUserId.split(':').shift()?.slice(1);

			const targetMembershipEvent =
				await stateService.buildEvent<'m.room.member'>(
					{
						type: 'm.room.member',
						content: {
							membership: 'join',
							is_direct: true,
							displayname: displayname,
						},
						room_id: roomCreateEvent.roomId,
						state_key: targetUserId,
						auth_events: [],
						depth: 0,
						prev_events: [],
						origin_server_ts: Date.now(),
						sender: creatorUserId,
					},
					PersistentEventFactory.defaultRoomVersion,
				);

			await stateService.handlePdu(targetMembershipEvent);
		}

		return roomCreateEvent.roomId;
	}

	private async findExistingDirectMessageRoom(
		userId1: UserID,
		userId2: UserID,
	): Promise<RoomID | null> {
		try {
			const membershipEvents = await this.eventRepository
				.findMembershipEventsFromDirectMessageRooms([userId1, userId2])
				.toArray();

			const roomMemberCounts = new Map<RoomID, Set<string>>();

			for (const event of membershipEvents) {
				const roomId = event.event.room_id;
				const stateKey = event.event.state_key;

				if (!stateKey) continue;

				if (!roomMemberCounts.has(roomId)) {
					roomMemberCounts.set(roomId, new Set());
				}
				const roomMembers = roomMemberCounts.get(roomId);
				if (roomMembers) {
					roomMembers.add(stateKey);
				}
			}

			for (const [roomId, members] of roomMemberCounts) {
				if (
					members.size === 2 &&
					members.has(userId1) &&
					members.has(userId2)
				) {
					const currentMembers =
						await this.eventRepository.findAllJoinedMembersEventsByRoomId(
							roomId,
						);
					const currentUserIds = currentMembers
						.map((m) => m.event.state_key)
						.filter(Boolean);

					if (
						currentUserIds.length === 2 &&
						currentUserIds.includes(userId1) &&
						currentUserIds.includes(userId2)
					) {
						return roomId;
					}
				}
			}

			return null;
		} catch (error) {
			logger.error({
				msg: 'Error finding existing DM room between users',
				userId1,
				userId2,
				err: error,
			});
			return null;
		}
	}
}
