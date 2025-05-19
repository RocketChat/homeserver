import type { EventBase } from "@hs/core/src/events/eventBase";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { EventBase as ModelEventBase } from "../models/event.model";
import { createRoom } from "../procedures/createRoom";
import { RoomRepository } from "../repositories/room.repository";
import { ConfigService } from "./config.service";
import { EventService } from "./event.service";

// Utility function to create a random ID for room creation
function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		result += characters[randomIndex];
	}
	return result;
}

@Injectable()
export class RoomService {
	private readonly logger = new Logger(RoomService.name);

	constructor(
		private readonly roomRepository: RoomRepository,
		private readonly eventService: EventService,
		private readonly configService: ConfigService,
	) {}

	async upsertRoom(roomId: string, state: ModelEventBase[]) {
		this.logger.log(
			`Upserting room ${roomId} with ${state.length} state events`,
		);

		// Find the create event to determine room version
		const createEvent = state.find((event) => event.type === "m.room.create");
		if (createEvent) {
			this.logger.log(`Found create event for room ${roomId}`);
		}

		// Find power levels
		const powerLevelsEvent = state.find(
			(event) => event.type === "m.room.power_levels",
		);
		if (powerLevelsEvent) {
			this.logger.log(`Found power levels event for room ${roomId}`);
		}

		// Count member events
		const memberEvents = state.filter(
			(event) => event.type === "m.room.member",
		);
		this.logger.log(`Room ${roomId} has ${memberEvents.length} member events`);

		try {
			await this.roomRepository.upsert(roomId, state);
			this.logger.log(`Successfully upserted room ${roomId}`);
		} catch (error) {
			this.logger.error(`Failed to upsert room ${roomId}: ${error}`);
			throw error;
		}
	}

	/**
	 * Create a new room with the given sender and username
	 */
	async createRoom(
		username: string,
		sender: string,
	): Promise<{
		roomId: string;
		events: EventBase[];
	}> {
		this.logger.debug(`Creating room for ${sender} with ${username}`);
		const config = this.configService.getServerConfig();
		const signingKey = await this.configService.getSigningKey();

		if (sender.split(":").pop() !== config.name) {
			throw new HttpException("Invalid sender", HttpStatus.BAD_REQUEST);
		}

		const roomId = `!${createMediaId(18)}:${config.name}`;
		const result = await createRoom(
			[sender, username],
			createSignedEvent(
				Array.isArray(signingKey) ? signingKey[0] : signingKey,
				config.name,
			),
			roomId,
		);

		if (result.events.filter(Boolean).length === 0) {
			throw new HttpException(
				"Error creating room",
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}

		for (const eventObj of result.events) {
			await this.eventService.insertEvent(eventObj.event, eventObj._id);
		}

		return {
			roomId: result.roomId,
			events: result.events.map((e) => e.event),
		};
	}
}
