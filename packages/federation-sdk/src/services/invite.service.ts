import { EventBaseWithOptionalId, HttpException, HttpStatus } from '@hs/core';
import { ConfigService, FederationService } from '@hs/federation-sdk';
import { PersistentEventFactory, RoomVersion } from '@hs/room';
import { inject, singleton } from 'tsyringe';
import { createLogger } from '../utils/logger';
import { EventService } from './event.service';
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
		@inject('StateService') private readonly stateService: StateService,
		@inject('ConfigService') private readonly configService: ConfigService,
	) {}

	/**
	 * Invite a user to an existing room
	 */
	async inviteUserToRoom(
		userId: string,
		roomId: string,
		sender: string,
		isDirectMessage = false,
	) {
		this.logger.debug(`Inviting ${userId} to room ${roomId}`);

		const stateService = this.stateService;
		const federationService = this.federationService;

		const roomInformation = await stateService.getRoomInformation(roomId);

		const inviteEvent = isDirectMessage
			? PersistentEventFactory.newDirectMessageMembershipEvent(
					roomId,
					sender,
					userId,
					'invite',
					roomInformation,
				)
			: PersistentEventFactory.newMembershipEvent(
					roomId,
					sender,
					userId,
					'invite',
					roomInformation,
				);

		await stateService.addAuthEvents(inviteEvent);

		await stateService.addPrevEvents(inviteEvent);

		await stateService.signEvent(inviteEvent);

		// SPEC: Invites a remote user to a room. Once the event has been signed by both the inviting homeserver and the invited homeserver, it can be sent to all of the servers in the room by the inviting homeserver.

		const invitedServer = inviteEvent.stateKey?.split(':').pop();
		if (!invitedServer) {
			throw new Error(
				`invalid state_key ${inviteEvent.stateKey}, no server_name part`,
			);
		}

		// if user invited belongs to our server
		if (invitedServer === this.configService.getServerName()) {
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
			throw new Error(`Invalid roomId ${roomId}`);
		}

		const inviteEvent = PersistentEventFactory.createFromRawEvent(
			event as unknown as Parameters<
				typeof PersistentEventFactory.createFromRawEvent
			>[0],
			roomVersion as RoomVersion,
		);

		if (inviteEvent.eventId !== eventId) {
			throw new Error(`Invalid eventId ${eventId}`);
		}

		await this.stateService.signEvent(inviteEvent);

		if (residentServer === this.configService.getServerName()) {
			// we are the host of the server

			// attempt to persist the invite event as we already have the state

			await this.stateService.persistStateEvent(inviteEvent);
			if (inviteEvent.rejected) {
				throw new Error(inviteEvent.rejectedReason);
			}

			// we do not send transaction here
			// the asking server will handle the transactions

			// return the signed invite event
			return inviteEvent;
		}

		// are we already in the room?
		try {
			await this.stateService.getRoomInformation(roomId);

			// if we have the state we try to persist the invite event
			await this.stateService.persistStateEvent(inviteEvent);
			if (inviteEvent.rejected) {
				throw new Error(inviteEvent.rejectedReason);
			}
		} catch (e) {
			// don't have state copy yet
			console.error(e);

			// typical noop, we sign and return the event, nothing to do
		}

		// we are not the host of the server
		// so being the origin of the user, we sign the event and send it to the asking server, let them handle the transactions
		return inviteEvent;
	}
}
