import { Injectable } from "@nestjs/common";
import type { EventBase } from "../models/event.model";
import { RoomRepository } from "../repositories/room.repository";
import { LoggerService } from "./logger.service";

@Injectable()
export class RoomService {
	private readonly logger: LoggerService;

	constructor(
    private readonly roomRepository: RoomRepository,
    private readonly loggerService: LoggerService
  ) {
    this.logger = this.loggerService.setContext('RoomService');
  }

	async upsertRoom(roomId: string, state: EventBase[]) {
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
}
