import type { EventBase, EventStore } from '@hs/core';
import { createLogger } from '@hs/core';
import { singleton } from 'tsyringe';
import type { MissingEventType } from '../queues/missing-event.queue';
import { MissingEventsQueue } from '../queues/missing-event.queue';
import { EventFetcherService } from '../services/event-fetcher.service';
import { EventService } from '../services/event.service';
import { StagingAreaService } from '../services/staging-area.service';

@singleton()
export class MissingEventListener {
	private readonly logger = createLogger('MissingEventListener');

	constructor(
		private readonly missingEventsQueue: MissingEventsQueue,
		private readonly stagingAreaService: StagingAreaService,
		private readonly eventService: EventService,
		private readonly eventFetcherService: EventFetcherService,
	) {
		this.missingEventsQueue.registerHandler(this.handleQueueItem.bind(this));
	}

	private async processStagedEvents() {
		const stagedEvents = await this.eventService.findStagedEvents();

		if (stagedEvents.length === 0) {
			return;
		}

		this.logger.debug(
			`Checking ${stagedEvents.length} staged events for processing`,
		);

		for (const stagedEvent of stagedEvents) {
			try {
				const missingDependencies = stagedEvent.missing_dependencies || [];

				if (missingDependencies.length === 0) {
					await this.processAndStoreStagedEvent(stagedEvent);
					this.logger.debug(`Processed staged event ${stagedEvent._id}`);
				}
			} catch (err) {
				const error = err as Error;
				this.logger.error(
					`Error processing staged event ${stagedEvent._id}: ${error.message || String(error)}`,
				);
			}
		}
	}

	private extractDependencies(event: EventBase): string[] {
		const authEvents = event.auth_events || [];
		const prevEvents = event.prev_events || [];
		return [...new Set([...authEvents, ...prevEvents].flat())];
	}

	private async processAndStoreStagedEvent(stagedEvent: EventStore) {
		try {
			this.stagingAreaService.addEventToQueue({
				eventId: stagedEvent._id,
				roomId: stagedEvent.event.room_id,
				origin: stagedEvent.event.origin,
				event: stagedEvent.event,
			});

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

	private async updateStagedEventDependencies(resolvedEventId: string) {
		try {
			const updatedCount =
				await this.eventService.removeDependencyFromStagedEvents(
					resolvedEventId,
				);

			if (updatedCount > 0) {
				this.logger.debug(
					`Updated ${updatedCount} staged events after resolving dependency ${resolvedEventId}`,
				);
			}
		} catch (err) {
			const error = err as Error;
			this.logger.error(
				`Error updating staged event dependencies: ${error.message || String(error)}`,
			);
		}
	}

	async handleQueueItem(data: MissingEventType) {
		const { eventId, roomId, origin } = data;

		const exists = await this.eventService.getEventById(eventId);
		if (exists) {
			this.logger.debug(
				`Event ${eventId} already exists in database (staged or processed), marking as fetched`,
			);
			await this.updateStagedEventDependencies(eventId);
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
				const dependencies = this.extractDependencies(event);
				const { missing } =
					await this.eventService.checkIfEventsExists(dependencies);

				this.logger.debug(
					`Storing event ${eventId} as staged${missing.length ? ` with ${missing.length} missing dependencies` : ' (ready to process)'}`,
				);

				await this.eventService.storeEventAsStaged({
					_id: eventId,
					event: event,
					missing_dependencies: missing,
				});

				if (missing.length > 0) {
					for (const missingId of missing) {
						this.missingEventsQueue.enqueue({
							eventId: missingId,
							roomId,
							origin,
						});
					}
				}

				await this.updateStagedEventDependencies(eventId);
				return this.processStagedEvents();
			}
		} catch (err: unknown) {
			this.logger.error(
				`Error fetching missing event ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}
