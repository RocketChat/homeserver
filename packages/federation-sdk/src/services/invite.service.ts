import { createLogger } from '@rocket.chat/federation-core';
import {
	EventID,
	PduForType,
	PersistentEventBase,
	PersistentEventFactory,
	RoomID,
	RoomVersion,
	UserID,
	extractDomainFromId,
} from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import { FederationService } from './federation.service';
import { StateService } from './state.service';
export class NotAllowedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NotAllowedError';
	}
}

@singleton()
export class InviteService {
	private readonly logger = createLogger('InviteService');

	constructor(
		private readonly federationService: FederationService,
		private readonly stateService: StateService,
		private readonly configService: ConfigService,
		private readonly emitterService: EventEmitterService,
		@inject(delay(() => EventRepository))
		private readonly eventRepository: EventRepository,
	) {}

	/**
	 * Invite a user to an existing room
	 */
	async inviteUserToRoom(
		userId: UserID,
		roomId: RoomID,
		sender: UserID,
		isDirectMessage = false,
	): Promise<{
		event_id: EventID;
		event: PersistentEventBase<RoomVersion, 'm.room.member'>;
		room_id: RoomID;
	}> {
		this.logger.debug(`Inviting ${userId} to room ${roomId}`);

		const stateService = this.stateService;
		const federationService = this.federationService;

		const roomVersion = await this.stateService.getRoomVersion(roomId);

		// Extract displayname from userId for direct messages
		const displayname = isDirectMessage
			? userId.split(':').shift()?.slice(1)
			: undefined;

		const inviteEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: {
					membership: 'invite',
					...(isDirectMessage && {
						is_direct: true,
						displayname: displayname,
					}),
				},
				room_id: roomId,
				state_key: userId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: sender,
			},

			roomVersion,
		);

		// SPEC: Invites a remote user to a room. Once the event has been signed by both the inviting homeserver and the invited homeserver, it can be sent to all of the servers in the room by the inviting homeserver.

		const invitedServer = extractDomainFromId(inviteEvent.stateKey ?? '');
		if (!invitedServer) {
			throw new Error(
				`invalid state_key ${inviteEvent.stateKey}, no server_name part`,
			);
		}

		// if user invited belongs to our server
		if (invitedServer === this.configService.serverName) {
			await stateService.handlePdu(inviteEvent);

			// let all servers know of this state change
			// without it join events will not be processed if /event/{eventId} causes problems
			void federationService.sendEventToAllServersInRoom(inviteEvent);

			this.emitterService.emit('homeserver.matrix.membership', {
				event_id: inviteEvent.eventId,
				event: inviteEvent.event,
			});

			return {
				event_id: inviteEvent.eventId,
				event: PersistentEventFactory.createFromRawEvent(
					inviteEvent.event,
					roomVersion,
				),
				room_id: roomId,
			};
		}

		// invited user from another room
		// get signed invite event

		const inviteResponse = await federationService.inviteUser(
			inviteEvent,
			roomVersion,
		);

		// try to save
		// can only invite if already part of the room
		await stateService.handlePdu(
			PersistentEventFactory.createFromRawEvent(
				inviteResponse.event,
				roomVersion,
			),
		);

		// let everyone know
		void federationService.sendEventToAllServersInRoom(inviteEvent);

		this.emitterService.emit('homeserver.matrix.membership', {
			event_id: inviteEvent.eventId,
			event: inviteEvent.event,
		});

		return {
			event_id: inviteEvent.eventId,
			event: PersistentEventFactory.createFromRawEvent(
				inviteEvent.event,
				roomVersion,
			),
			room_id: roomId,
		};
	}

	private async shouldProcessInvite(
		strippedStateEvents: PduForType<
			| 'm.room.create'
			| 'm.room.name'
			| 'm.room.avatar'
			| 'm.room.topic'
			| 'm.room.join_rules'
			| 'm.room.canonical_alias'
			| 'm.room.encryption'
		>[],
	): Promise<void> {
		const isRoomNonPrivate = strippedStateEvents.some(
			(stateEvent) =>
				stateEvent.type === 'm.room.join_rules' &&
				stateEvent.content.join_rule === 'public',
		);

		const isRoomEncrypted = strippedStateEvents.some(
			(stateEvent) => stateEvent.type === 'm.room.encryption',
		);

		const { allowedEncryptedRooms, allowedNonPrivateRooms } =
			this.configService.getConfig('invite');

		const shouldRejectInvite =
			(!allowedEncryptedRooms && isRoomEncrypted) ||
			(!allowedNonPrivateRooms && isRoomNonPrivate);
		if (shouldRejectInvite) {
			throw new NotAllowedError(
				`Could not process invite due to room being ${isRoomEncrypted ? 'encrypted' : 'public'}`,
			);
		}
	}

	async processInvite(
		event: PduForType<'m.room.member'>,
		eventId: EventID,
		roomVersion: RoomVersion,
	): Promise<PersistentEventBase<RoomVersion, 'm.room.member'>> {
		if (!event.unsigned?.invite_room_state) {
			throw new Error(
				'Missing invite_room_state required for policy validation',
			);
		}
		await this.shouldProcessInvite(event.unsigned.invite_room_state);

		const inviteEvent =
			PersistentEventFactory.createFromRawEvent<'m.room.member'>(
				event,
				roomVersion,
			);

		if (inviteEvent.eventId !== eventId) {
			throw new Error(`Invalid eventId ${eventId}`);
		}

		await this.stateService.signEvent(inviteEvent);

		await this.eventRepository.insertInviteEvent(
			inviteEvent.eventId,
			inviteEvent.event,
			residentServer,
		);

		this.emitterService.emit('homeserver.matrix.membership', {
			event_id: inviteEvent.eventId,
			event: inviteEvent.event,
		});

		// we are not the host of the server
		// so being the origin of the user, we sign the event and send it to the asking server, let them handle the transactions
		return inviteEvent;
	}
}
