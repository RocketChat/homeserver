import { Injectable, Logger } from "@nestjs/common";
import { StateEventRepository } from "../repositories/state-event.repository";
import { resolveStateV2Plus } from "@hs/room/src/v2_resolution";
import { V2Pdu } from "@hs/room/src/events";
import { EventStore, EventStoreRemote } from "@hs/room/src/state_resolution/definitions/definitions";
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

		const stateEvents = await (
			await this.stateEventRepository.findByRoomId(roomId)
		).toArray();
		
		const [{ event }] = await this.eventService.findEvents({ _id: eventId, roomId });

		// FIXME: missing hashes
		const state = await resolveStateV2Plus(stateEvents.concat(event) as unknown as V2Pdu[], {
			store: {
				getEvents: async (eventIds: string[]) => {
					return (await this.eventService.getEventsByIds(eventIds)).map(
						({ event }) => event,
					) as unknown as V2Pdu[]; // hashes is missingh again
				},
			},
			remote: {} as EventStoreRemote, // all evenrts should alreqdy be in store by this point1
		});

		await this.stateEventRepository.updateState(
			roomId,
			state.values().toArray(),
		);

		this.logger.debug(`State resolved for room ${roomId}`);
	}
}
