import { FederationService } from "@hs/federation-sdk";
import { Injectable, Logger } from "@nestjs/common";
import type { EventBase } from "../models/event.model";
import { ConfigService } from "./config.service";
import { EventService } from "./event.service";
import { RoomService } from "./room.service";
import { ServerService } from "./server.service";

interface MatrixEvent extends EventBase {
	origin: string;
}

type MakeJoinResponse = {
	event: any;
};

type SendJoinResponse = {
	state: any[];
	auth_chain: any[];
	event?: any;
};

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
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		private readonly serverService: ServerService,
		private readonly roomService: RoomService,
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

			// Waits 5 seconds before accepting invite - just for testing purposes
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
			const serverConfig = this.configService.getServerConfig();
			
			// Step 1: Make a join request to get the join event template
			const responseMake = await this.federationService.makeJoin(event.event.origin, event.event.room_id, event.event.state_key, event.room_version);
			this.logger.debug('responseMake', responseMake);
			
			// Step 2: Send the join event
			const responseBody = await this.federationService.sendJoin(event.event.origin, event.event.room_id, event.event.state_key, responseMake.event, false);
			this.logger.debug('responseBody', responseBody);

			// // Step 3: Validate the response
			// const createEvent = responseBody.state.find(e => e.type === "m.room.create");
			// if (!createEvent) {
			// 	throw new MatrixError("400", "Invalid response: missing m.room.create event");
			// }

			// if (responseBody.event) {
			// 	await this.eventService.insertEvent(responseBody.event);
			// 	this.logger.log(`Stored join event for ${event.event.state_key}`);
			// }

			// // Step 4: Process auth chain and state
			// const auth_chain = new Map(
			// 	responseBody.auth_chain.map((e: any) => [generateId(e), e]),
			// );
			// const state = new Map(
			// 	responseBody.state.map((e: any) => [generateId(e), e]),
			// );

			// Step 5: Setup public key retrieval function
			// const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
			// 	this.serverService.getValidPublicKeyFromLocal,
			// 	(origin: string, key: string) =>
			// 		getPublicKeyFromRemoteServer(origin, serverConfig.name, key),
			// 	this.serverService.storePublicKey,
			// );

			// // Step 6: Validate PDUs
			// const validPDUs = new Map<string, MatrixEvent>();
			// let validCount = 0;
			// let invalidCount = 0;

			// for await (const [eventId, pduEvent] of [
			// 	...auth_chain.entries(),
			// 	...state.entries(),
			// ]) {
			// 	try {
			// 		const isValid = await checkSignAndHashes(
			// 			pduEvent as any,
			// 			(pduEvent as any).origin,
			// 			getPublicKeyFromServer,
			// 		);

			// 		if (isValid) {
			// 			validPDUs.set(eventId as string, pduEvent as MatrixEvent);
			// 			validCount++;
			// 		} else {
			// 			this.logger.warn(`Invalid event ${eventId} of type ${pduEvent.type}`);
			// 			invalidCount++;
			// 		}
			// 	} catch (e: any) {
			// 		this.logger.error(`Error checking signature for event ${eventId}: ${e.message}`);
			// 		console.log(e);
			// 		invalidCount++;
			// 	}
			// }

			// // Step 7: Get the create event
			// const signedCreateEvent = [...validPDUs.entries()].find(
			// 	([, eventData]) => eventData.type === "m.room.create",
			// );

			// if (!signedCreateEvent) {
			// 	throw new MatrixError("400", "Unexpected create event(s) in auth chain");
			// }

			// // Step 8: Upsert room and events
			// await this.roomService.upsertRoom(signedCreateEvent[1].room_id, [
			// 	...validPDUs.values(),
			// ]);

			// await Promise.all(
			// 	[...validPDUs.entries()].map(([_, eventData]) =>
			// 		this.eventService.insertEvent(eventData),
			// 	),
			// );
		} catch (error: any) {
			this.logger.error(
				`Error processing invite for ${event.event.state_key} in room ${event.event.room_id}: ${error.message}`,
			);
			throw error;
		}
	}
}
