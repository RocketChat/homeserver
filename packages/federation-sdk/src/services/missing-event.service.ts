import type { EventStore } from '@hs/core';
import { createLogger } from '@hs/core';
import type { Pdu } from '@hs/room';

import { singleton } from 'tsyringe';
import { EventFetcherService } from './event-fetcher.service';
import { EventService } from './event.service';
import { StateService } from './state.service';

type MissingEventType = {
	eventId: string;
	roomId: string;
	// TODO: check what to do with origin
	origin: string;
};

@singleton()
export class MissingEventService {
	private readonly logger = createLogger('EventService');

	constructor(
		private readonly eventService: EventService,
		private readonly stateService: StateService,
		private readonly eventFetcherService: EventFetcherService,
	) {}

	async fetchMissingEvent(data: MissingEventType) {
		const { eventId, roomId, origin } = data;

		const exists = await this.eventService.getEventById(eventId);
		if (exists) {
			this.logger.debug(
				`Event ${eventId} already exists in database (staged or processed), marking as fetched`,
			);
			// await this.updateStagedEventDependencies(eventId);
			return;
		}

		try {
			const fetchedEvents = await this.eventFetcherService.fetchEventsByIds(
				[eventId],
				roomId,
				origin,
			);
			if (fetchedEvents.events.length === 0) {
				this.logger.warn(
					`Failed to fetch missing event ${eventId} from ${origin}`,
				);
				return;
			}

			for (const { event, eventId } of fetchedEvents.events) {
				this.logger.debug(`Persisting fetched missing event ${eventId}`);

				// TODO what to do with missing dependencies from received event?
				await this.stateService.persistEvent(event);

				// const dependencies = this.extractDependencies(event);
				// const { missing } =
				// 	await this.eventService.checkIfEventsExists(dependencies);

				// this.logger.debug(
				// 	`Storing event ${eventId} as staged${missing.length ? ` with ${missing.length} missing dependencies` : ' (ready to process)'}`,
				// );

				// await this.eventService.storeEventAsStaged({
				// 	_id: eventId,
				// 	event,
				// 	// missing_dependencies: missing,
				// });

				// if (missing.length > 0) {
				// 	for (const missingId of missing) {
				// 		this.missingEventsQueue.enqueue({
				// 			eventId: missingId,
				// 			roomId,
				// 			origin,
				// 		});
				// 	}
				// }

				// await this.updateStagedEventDependencies(eventId);
				// return this.processStagedEvents();
			}
		} catch (err: unknown) {
			this.logger.error(
				`Error fetching missing event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	// private async updateStagedEventDependencies(resolvedEventId: string) {
	// 	try {
	// 		const updatedCount =
	// 			await this.eventService.removeDependencyFromStagedEvents(
	// 				resolvedEventId,
	// 			);

	// 		if (updatedCount > 0) {
	// 			this.logger.debug(
	// 				`Updated ${updatedCount} staged events after resolving dependency ${resolvedEventId}`,
	// 			);
	// 		}
	// 	} catch (err) {
	// 		const error = err as Error;
	// 		this.logger.error(
	// 			`Error updating staged event dependencies: ${error.message || String(error)}`,
	// 		);
	// 	}
	// }

	// private extractDependencies(event: Pdu): string[] {
	// 	const authEvents = event.auth_events || [];
	// 	const prevEvents = event.prev_events || [];
	// 	return [...new Set([...authEvents, ...prevEvents])];
	// }

	// private async processStagedEvents() {
	// 	const stagedEvents = await this.eventService.findStagedEvents();

	// 	if (stagedEvents.length === 0) {
	// 		return;
	// 	}

	// 	this.logger.debug(
	// 		`Checking ${stagedEvents.length} staged events for processing`,
	// 	);

	// 	for (const stagedEvent of stagedEvents) {
	// 		try {
	// 			const missingDependencies = stagedEvent.missing_dependencies || [];

	// 			if (missingDependencies.length === 0) {
	// 				await this.processAndStoreStagedEvent(stagedEvent);
	// 				this.logger.debug(`Processed staged event ${stagedEvent._id}`);
	// 			}
	// 		} catch (err) {
	// 			const error = err as Error;
	// 			this.logger.error(
	// 				`Error processing staged event ${stagedEvent._id}: ${error.message || String(error)}`,
	// 			);
	// 		}
	// 	}
	// }

	private async processAndStoreStagedEvent(stagedEvent: EventStore) {
		try {
			// TODO need to stage events here? if so, need to call the repository
			// this.stagingAreaService.addEventToQueue({
			// 	eventId: stagedEvent._id,
			// 	roomId: stagedEvent.event.room_id,
			// 	// TODO origin doesnt exist anymore
			// 	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
			// 	origin: (stagedEvent.event as any).origin,
			// 	event: stagedEvent.event,
			// });

			await this.eventService.markEventAsUnstaged(stagedEvent._id);
			this.logger.debug(
				`Added previously staged event ${stagedEvent._id} to processing queue`,
			);
		} catch (err) {
			const error = err as Error;
			this.logger.error(
				`Error processing staged event ${stagedEvent._id}: ${error.message || String(error)}`,
			);
		}
	}
}
