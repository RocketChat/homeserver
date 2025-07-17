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

		const residentServer = roomId.split(':').pop();

		if (!residentServer) {
			throw new Error(`invalid room_id ${roomId}, no server_name part`);
		}

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

		// room is on our server
		// we can resolve state by ourselves
		if (residentServer === this.configService.getServerName()) {
			await stateService.persistStateEvent(inviteEvent);

			if (inviteEvent.rejected) {
				throw new Error(inviteEvent.rejectedReason);
			}

			return {
				event_id: inviteEvent.eventId,
				room_id: roomId,
			};
		}

		// remote room, send the invite event to the original room
		// if accepted it will become part of the state
		// further attempt to join the room should be allowed then.

		const inviteResponse = await federationService.inviteUser(
			inviteEvent,
			roomInformation.room_version,
		);

		// can only invite if already part of the room
		await stateService.persistStateEvent(
			PersistentEventFactory.createFromRawEvent(
				inviteResponse.event,
				roomInformation.room_version as RoomVersion,
			),
		);

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
	>(event: T, roomId: string, eventId: string): Promise<{ event: T }> {
		try {
			// Check if the room is tombstoned (deleted)
			const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
			if (isTombstoned) {
				this.logger.warn(
					`Received invite for deleted room ${roomId}, rejecting`,
				);
				throw new HttpException(
					'Cannot process invite for a deleted room',
					HttpStatus.FORBIDDEN,
				);
			}

			// TODO: Validate before inserting
			try {
				await this.eventService.insertEvent(
					event as EventBaseWithOptionalId,
					eventId,
				);
			} catch (error: unknown) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				this.logger.error(`Event already exists: ${errorMessage}`);
				throw error;
			}

			this.logger.debug('Received invite event', {
				room_id: roomId,
				event_id: eventId,
				user_id: event.state_key,
				origin: event.origin,
			});

			// TODO: Remove this - Waits 5 seconds before accepting invite just for testing purposes
			void new Promise((resolve) => setTimeout(resolve, 5000)).then(() =>
				this.acceptInvite(roomId, event.state_key),
			);

			return { event: event };
		} catch (error: any) {
			this.logger.error(`Failed to process invite: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Accept an invite for a user
	 */
	async acceptInvite(roomId: string, userId: string): Promise<void> {
		try {
			// Check if the room is tombstoned (deleted)
			const isTombstoned = await this.roomService.isRoomTombstoned(roomId);
			if (isTombstoned) {
				this.logger.warn(
					`Attempt to accept invite for deleted room ${roomId}, rejecting`,
				);
				throw new HttpException(
					`Cannot accept invite for deleted room ${roomId}`,
					HttpStatus.FORBIDDEN,
				);
			}

			const inviteEvent = await this.eventService.findInviteEvent(
				roomId,
				userId,
			);

			if (!inviteEvent) {
				throw new Error(`No invite found for user ${userId} in room ${roomId}`);
			}

			await this.handleInviteProcessing({
				event: inviteEvent.event as EventBaseWithOptionalId & {
					origin: string;
					room_id: string;
					state_key: string;
				},
				invite_room_state: inviteEvent.invite_room_state,
				room_version: inviteEvent.room_version || '10',
			});
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.logger.error(`Failed to accept invite: ${errorMessage}`);
			throw error;
		}
	}

	/**
	 * Handle the processing of an invite event
	 */
	private async handleInviteProcessing(
		_event: ProcessInviteEvent,
	): Promise<void> {
		// try {
		// 	const responseMake = await this.federationService.makeJoin(
		// 		event.event.origin,
		// 		event.event.room_id,
		// 		event.event.state_key,
		// 		event.room_version,
		// 	);
		// 	const responseBody = await this.federationService.sendJoin(
		// 		event.event.origin,
		// 		event.event.room_id,
		// 		event.event.state_key,
		// 		responseMake.event,
		// 		false,
		// 	);
		// 	if (!responseBody.state || !responseBody.auth_chain) {
		// 		this.logger.warn(
		// 			`Invalid response: missing state or auth_chain arrays from event ${event.event.event_id}`,
		// 		);
		// 		return;
		// 	}
		// 	const allEvents = [
		// 		...responseBody.state,
		// 		...responseBody.auth_chain,
		// 		responseBody.event,
		// 	];
		// 	// TODO: Bring it back the validation pipeline for production - commented out for testing purposes
		// 	// await this.eventService.processIncomingPDUs(allEvents);
		// 	// TODO: Also remove the insertEvent calls :)
		// 	for (const event of allEvents) {
		// 		await this.eventService.insertEventIfNotExists(event);
		// 	}
		// 	this.logger.debug(
		// 		`Inserted ${allEvents.length} events for room ${event.event.room_id} right after the invite was accepted`,
		// 	);
		// } catch (error: unknown) {
		// 	const errorMessage =
		// 		error instanceof Error ? error.message : String(error);
		// 	this.logger.error(
		// 		`Error processing invite for ${event.event.state_key} in room ${event.event.room_id}: ${errorMessage}`,
		// 	);
		// 	throw error;
		// }
	}
}
