import { EventBaseWithOptionalId, HttpException, HttpStatus } from '@hs/core';
import { ConfigService, FederationService } from '@hs/federation-sdk';
import { PersistentEventFactory, RoomVersion } from '@hs/room';
import { inject, singleton } from 'tsyringe';
import { createLogger } from '../utils/logger';
import { EventService } from './event.service';
import { RoomService } from './room.service';
import { StateService } from './state.service';
// TODO: Have better (detailed/specific) event input type
export type ProcessInviteEvent = {
	event: EventBaseWithOptionalId & {
		origin: string;
		room_id: string;
		state_key: string;
	};
	invite_room_state: unknown;
	room_version: string;
};

@singleton()
export class InviteService {
	private readonly logger = createLogger('InviteService');

	constructor(
		@inject('EventService') private readonly eventService: EventService,
		@inject('FederationService')
		private readonly federationService: FederationService,
		@inject('RoomService') private readonly roomService: RoomService,
		@inject('StateService') private readonly stateService: StateService,
		@inject('ConfigService') private readonly configService: ConfigService,
	) {}

	/**
	 * Invite a user to an existing room
	 */
	async inviteUserToRoom(userId: string, roomId: string, sender: string) {
		this.logger.debug(`Inviting ${userId} to room ${roomId}`);

		const stateService = this.stateService;
		const federationService = this.federationService;

		const roomInformation = await stateService.getRoomInformation(roomId);

		const inviteEvent = PersistentEventFactory.newMembershipEvent(
			roomId,
			sender,
			userId,
			'invite',
			roomInformation,
		);

		await stateService.addAuthEvents(inviteEvent);

		await stateService.addPrevEvents(inviteEvent);

		await stateService.signEvent(inviteEvent);

		this.logger.info({ inviteEvent: inviteEvent.event }, 'invite event signed');

		// SPEC: Invites a remote user to a room. Once the event has been signed by both the inviting homeserver and the invited homeserver, it can be sent to all of the servers in the room by the inviting homeserver.

		const invitedServer = inviteEvent.stateKey?.split(':').pop();
		if (!invitedServer) {
			throw new Error(
				`invalid state_key ${inviteEvent.stateKey}, no server_name part`,
			);
		}

		// if user invited belongs to our server
		if (invitedServer === this.configService.getServerName()) {
			this.logger.info('trying to save invite ourselves as we are the host');

			await stateService.persistStateEvent(inviteEvent);

			if (inviteEvent.rejected) {
				throw new Error(inviteEvent.rejectedReason);
			}

			// let all servers know of this state change
			// without it join events will not be processed if /event/{eventId} causes problems
			void federationService.sendEventToAllServersInRoom(inviteEvent);

			return {
				event_id: inviteEvent.eventId,
				room_id: roomId,
			};
		}

		// invited user from another room
		// get signed invite event

		this.logger.info('inviting user to another server');

		const inviteResponse = await federationService.inviteUser(
			inviteEvent,
			roomInformation.room_version,
		);

		// try to save
		// can only invite if already part of the room
		await stateService.persistStateEvent(
			PersistentEventFactory.createFromRawEvent(
				inviteResponse.event,
				roomInformation.room_version as RoomVersion,
			),
		);

		// let everyone know
		void federationService.sendEventToAllServersInRoom(inviteEvent);

		return {
			event_id: inviteEvent.eventId,
			room_id: roomId,
		};
	}

	// processInvite handled /invite/ endpoint request, WE were invited
	async processInvite<
		T extends Omit<EventBaseWithOptionalId, 'origin'> & {
			origin?: string | undefined;
			room_id: string;
			state_key: string;
		},
	>(event: T, roomId: string, eventId: string, roomVersion: string) {
		// SPEC: when a user invites another user on a different homeserver, a request to that homeserver to have the event signed and verified must be made

		const residentServer = roomId.split(':').pop();
		if (!residentServer) {
			this.logger.error({ roomId }, 'Invalid roomId');
			throw new Error(`Invalid roomId ${roomId}`);
		}

		this.logger.debug({ roomId, eventId, roomVersion }, 'processing invite');

		const inviteEvent = PersistentEventFactory.createFromRawEvent(
			event as any,
			roomVersion as RoomVersion,
		);

		if (inviteEvent.eventId !== eventId) {
			throw new Error(`Invalid eventId ${eventId}`);
		}

		await this.stateService.signEvent(inviteEvent);

		this.logger.debug(
			{ inviteEvent: inviteEvent.event },
			'invite event signed',
		);

		if (residentServer === this.configService.getServerName()) {
			this.logger.debug(
				'we are the host of the server, attempting to make invite event part of our state',
			);

			// attempt to persist the invite event as we already have the state

			await this.stateService.persistStateEvent(inviteEvent);
			if (inviteEvent.rejected) {
				this.logger.error(
					{ inviteEvent: inviteEvent.event },
					'invite event rejected',
				);
				throw new Error(inviteEvent.rejectedReason);
			}

			this.logger.debug('invite event persisted');

			// we do not send transaction here
			// the asking server will handle the transactions

			// return the signed invite event
			return inviteEvent;
		}

		// are we already in the room?
		try {
			this.logger.debug('checking if we are already in the room');

			await this.stateService.getRoomInformation(roomId);

			this.logger.debug(
				'we have the state, attempting to persist the invite event',
			);

			// if we have the state we try to persist the invite event
			await this.stateService.persistStateEvent(inviteEvent);
			if (inviteEvent.rejected) {
				throw new Error(inviteEvent.rejectedReason);
			}
		} catch (e) {
			// don't have state copy yet
			this.logger.error(
				{ error: e },
				'error checking if we are already in the room',
			);

			// typical noop, we sign and return the event, nothing to do
		}

		this.logger.debug('responding with signed invite event previously logged');

		// we are not the host of the server
		// so being the origin of the user, we sign the event and send it to the asking server, let them handle the transactions
		return inviteEvent;
	}
}
