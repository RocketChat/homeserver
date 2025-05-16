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
type ProcessInviteEvent = {
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

	async processInvite(event: ProcessInviteEvent): Promise<unknown> {
		try {
			// TODO: Check if event is already in the database and also validate if before processing
			await this.eventService.insertEvent(event.event);
			
			await this.handleInviteProcessing(event);
			
			return { event };
		} catch (error: any) {
			this.logger.error(`Failed to process invite: ${error.message}`);
			throw error;
		}
	}

	private async handleInviteProcessing(event: ProcessInviteEvent): Promise<void> {
		try {
			const serverConfig = this.configService.getServerConfig();

			// Step 1: Make a join request to get the join event template
			// const responseMake = (await makeSignedRequest({
			// 	method: "GET",
			// 	domain: event.origin,
			// 	uri: `/_matrix/federation/v1/make_join/${event.room_id}/${event.state_key}` as any,
			// 	signingKey: signingKey[0],
			// 	signingName: serverConfig.name,
			// 	queryString: "ver=10",
			// })) as MakeJoinResponse;
			console.log(event.event.origin, event.event.room_id, event.event.state_key, event.room_version);
			const responseMake = await this.federationService.makeJoin(event.event.origin, event.event.room_id, event.event.state_key, event.room_version);
			this.logger.log('responseMake', responseMake);
			
			// // Step 2: Send the join event
			// // const responseBody = (await makeSignedRequest({
			// // 	method: "PUT",
			// // 	domain: event.origin,
			// // 	uri: `/_matrix/federation/v2/send_join/${event.room_id}/${event.state_key}` as any,
			// // 	body: {
			// // 		...responseMake.event,
			// // 		origin: serverConfig.name,
			// // 		origin_server_ts: Date.now(),
			// // 		depth: responseMake.event.depth + 1,
			// // 	},
			// // 	signingKey: signingKey[0],
			// // 	signingName: serverConfig.name,
			// // 	queryString: "omit_members=false",
			// // })) as SendJoinResponse;
			// const responseBody = await this.federationService.sendJoin(event.origin, event.room_id, event.state_key, responseMake.event, false);
			// this.logger.log(responseBody);

			// // Step 3: Validate the response
			// const createEvent = responseBody.state.find(e => e.type === "m.room.create");
			// if (!createEvent) {
			// 	throw new MatrixError("400", "Invalid response: missing m.room.create event");
			// }

			// if (responseBody.event) {
			// 	await this.eventService.insertEvent(responseBody.event);
			// 	this.logger.log(`Stored join event for ${event.state_key}`);
			// }

			// // Step 4: Process auth chain and state
			// const auth_chain = new Map(
			// 	responseBody.auth_chain.map((e: any) => [generateId(e), e]),
			// );
			// const state = new Map(
			// 	responseBody.state.map((e: any) => [generateId(e), e]),
			// );

			// // Step 5: Setup public key retrieval function
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
				`Error processing invite for ${event?.state_key} in room ${event?.room_id}: ${error.message}`,
			);
			throw error;
		}
	}
}
