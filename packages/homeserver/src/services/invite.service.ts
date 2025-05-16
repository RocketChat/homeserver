import { FederationService } from "@hs/federation-sdk";
import { Injectable, Logger } from "@nestjs/common";
import type { EventBase } from "../models/event.model";
import { EventService } from "./event.service";

// TODO: Have better (detailed/specific) event input type
export type ProcessInviteEvent = {
	event: EventBase & { origin: string, room_id: string, state_key: string };
	invite_room_state: unknown;
	room_version: string;
};

@Injectable()
export class InviteService {
	private readonly logger = new Logger(InviteService.name);
	
	constructor(
		private readonly eventService: EventService,
		private readonly federationService: FederationService,
  	) {}

	async processInvite(event: ProcessInviteEvent, roomId: string, eventId: string): Promise<unknown> {
		try {
			await this.eventService.insertEvent(event.event, undefined, {
				invite_room_state: event.invite_room_state,
				room_version: event.room_version,
			});
			
			this.logger.debug('Received invite event', {
				room_id: roomId,
				event_id: eventId,
				user_id: event.event.state_key,
				origin: event.event.origin,
			});

			// TODO: Remove this - Waits 5 seconds before accepting invite just for testing purposes
			void new Promise(resolve => setTimeout(resolve, 5000))
				.then(() => this.acceptInvite(roomId, event.event.state_key));
			
			return { event: event.event };
		} catch (error: any) {
			this.logger.error(`Failed to process invite: ${error.message}`);
			throw error;
		}
	}

	async acceptInvite(roomId: string, userId: string): Promise<void> {
		try {
			const inviteEvent = await this.eventService.findInviteEvent(roomId, userId);

			if (!inviteEvent) {
				throw new Error(`No invite found for user ${userId} in room ${roomId}`);
			}
			
			await this.handleInviteProcessing({
				event: inviteEvent.event as EventBase & { origin: string, room_id: string, state_key: string },
				invite_room_state: inviteEvent.invite_room_state,
				room_version: inviteEvent.room_version || "10",
			});
		} catch (error: any) {
			this.logger.error(`Failed to accept invite: ${error.message}`);
			throw error;
		}
	}

	private async handleInviteProcessing(event: ProcessInviteEvent): Promise<void> {
		try {
			const responseMake = await this.federationService.makeJoin(event.event.origin, event.event.room_id, event.event.state_key, event.room_version);
			const responseBody = await this.federationService.sendJoin(event.event.origin, event.event.room_id, event.event.state_key, responseMake.event, false);

			if (!responseBody.state || !responseBody.auth_chain) {
				this.logger.warn(`Invalid response: missing state or auth_chain arrays from event ${event.event.event_id}`);
				return;
			}

			const allEvents = [...responseBody.state, ...responseBody.auth_chain, responseBody.event];
			
			// TODO: Bring it back the validation pipeline for production - commented out for testing purposes
			// await this.eventService.processIncomingPDUs(allEvents);

			// TODO: Also remove the insertEvent calls :)
			for (const event of allEvents) {
				await this.eventService.insertEventIfNotExists(event);
			}

			this.logger.debug(`Inserted ${allEvents.length} events for room ${event.event.room_id} right after the invite was accepted`);
		} catch (error: any) {
			this.logger.error(
				`Error processing invite for ${event.event.state_key} in room ${event.event.room_id}: ${error.message}`,
			);
			throw error;
		}
	}
}
