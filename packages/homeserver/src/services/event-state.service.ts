import { Injectable, Logger } from "@nestjs/common";
import { StateEventRepository } from "../repositories/state-event.repository";
import { resolveStateV2Plus } from "@hs/room/src/v2_resolution";
import { V2Pdu } from "@hs/room/src/events";
import { EventStore } from "@hs/room/src/state_resolution/definitions/definitions";
import { EventService } from "./event.service";

@Injectable()
export class EventStateService {
	constructor(
		private readonly stateEventRepository: StateEventRepository,
		private readonly eventService: EventService,
	) {}

	private readonly logger = new Logger(EventStateService.name);

	async resolveState(roomId: string, eventId: string): Promise<void> {
		this.logger.debug(
			`Resolving state for room ${roomId} after event ${eventId}`,
		);

		// In a full implementation, this would:
		// 1. Get the room state before the event
		// 2. Apply state resolution algorithms if there are state conflicts
		// 3. Update the room state in the database

		const store = new (class implements EventStore {
			constructor(private readonly eventService: EventService) {}
			async getEvents(eventIds: string[]): Promise<V2Pdu[]> {
				return (await this.eventService.getEventsByIds(eventIds)).map(
					({ event }) => event,
				) as unknown as V2Pdu[]; // hashes is missingh again
			}
		})(this.eventService);

		const stateEvents = await (
			await this.stateEventRepository.findByRoomId(roomId)
		).toArray();

		// FIXME: missing hashes
		const state = await resolveStateV2Plus(stateEvents as unknown as V2Pdu[], {
			store,
			remote: store, // todo: federation-sdk, on the other hand current implementation makes sure all events are in the store
		});

		await this.stateEventRepository.updateState(
			roomId,
			state.values().toArray(),
		);

		this.logger.debug(`State resolved for room ${roomId}`);
	}
}
