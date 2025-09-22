import { EventBase, HttpException, HttpStatus } from '@hs/core';
import { PduForType, PersistentEventFactory, RoomVersion } from '@hs/room';
import { singleton } from 'tsyringe';
import { createLogger } from '../utils/logger';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { FederationService } from './federation.service';
import { StateService } from './state.service';
// TODO: Have better (detailed/specific) event input type
export type ProcessInviteEvent = {
	event: EventBase;
	invite_room_state: unknown;
	room_version: string;
};

@singleton()
export class InviteService {
	private readonly logger = createLogger('InviteService');

	constructor(
		private readonly eventService: EventService,

		private readonly federationService: FederationService,
		private readonly stateService: StateService,
		private readonly configService: ConfigService,
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

			roomInformation.room_version as RoomVersion,
		);

		// SPEC: Invites a remote user to a room. Once the event has been signed by both the inviting homeserver and the invited homeserver, it can be sent to all of the servers in the room by the inviting homeserver.

		const invitedServer = inviteEvent.stateKey?.split(':').pop();
		if (!invitedServer) {
			throw new Error(
				`invalid state_key ${inviteEvent.stateKey}, no server_name part`,
			);
		}

		// if user invited belongs to our server
		if (invitedServer === this.configService.serverName) {
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

	async processInvite(
		event: PduForType<'m.room.member'>,
		roomId: string,
		eventId: string,
		roomVersion: RoomVersion,
	) {
		// SPEC: when a user invites another user on a different homeserver, a request to that homeserver to have the event signed and verified must be made

		const residentServer = roomId.split(':').pop();
		if (!residentServer) {
			throw new Error(`Invalid roomId ${roomId}`);
		}

		const inviteEvent =
			PersistentEventFactory.createFromRawEvent<'m.room.member'>(
				event,
				roomVersion,
			);

		if (inviteEvent.eventId !== eventId) {
			throw new Error(`Invalid eventId ${eventId}`);
		}

		await this.stateService.signEvent(inviteEvent);

		if (residentServer === this.configService.serverName) {
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
		// nor are we part of the room now.

		await this.eventService.addPendingInvite(inviteEvent);

		// being the origin of the user, we sign the event and send it to the asking server, let them handle the transactions
		return inviteEvent;
	}
}
