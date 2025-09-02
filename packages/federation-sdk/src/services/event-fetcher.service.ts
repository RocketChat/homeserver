import { type MatrixPDU, isFederationEventWithPDUs } from '@hs/core';
import { createLogger } from '@hs/core';
import { generateId } from '@hs/core';
import type { EventBaseWithOptionalId } from '@hs/core';
import { singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { ConfigService } from './config.service';
import { FederationService } from './federation.service';

export interface FetchedEvents {
	events: { eventId: string; event: EventBaseWithOptionalId }[];
	missingEventIds: string[];
}

@singleton()
export class EventFetcherService {
	private readonly logger = createLogger('EventFetcherService');

	constructor(
		private readonly eventRepository: EventRepository,
		private readonly federationService: FederationService,
		private readonly configService: ConfigService,
	) {}

	public async fetchEventsByIds(
		eventIds: string[],
		roomId: string,
		originServer: string,
	): Promise<FetchedEvents> {
		this.logger.debug(`Fetching ${eventIds.length} events for room ${roomId}`);

		if (!eventIds || eventIds.length === 0) {
			return { events: [], missingEventIds: [] };
		}

		// Try to get events from local database
		const localEvents: { eventId: string; event: EventBaseWithOptionalId }[] =
			[];

		const dbEventsCursor = await this.eventRepository.findByIds(eventIds);
		for await (const event of dbEventsCursor) {
			localEvents.push({
				eventId: event._id,
				event: event.event,
			});
		}

		this.logger.debug(`Found ${localEvents.length} events in local database`);

		if (localEvents.length === eventIds.length) {
			return {
				events: localEvents,
				missingEventIds: [],
			};
		}

		// For events we don't have locally, try federation
		const missingEventIds = eventIds.filter(
			(id) => !localEvents.some((e) => e.eventId === id),
		);
		if (missingEventIds.length > 0) {
			this.logger.debug(
				`Fetching ${missingEventIds.length} missing events from federation ${Array.from(missingEventIds).join(', ')} ${originServer}`,
			);
			const federationEvents = await this.fetchEventsFromFederation(
				missingEventIds,
				originServer,
			);

			const federationEventsWithIds = federationEvents.map((e) => ({
				eventId: e.event_id ? String(e.event_id) : generateId(e),
				event: e,
			}));

			return {
				events: [...localEvents, ...federationEventsWithIds],
				missingEventIds: missingEventIds.filter(
					(id) => !federationEventsWithIds.some((e) => e.eventId === id),
				),
			};
		}

		return {
			events: localEvents,
			missingEventIds: [],
		};
	}

	public async fetchAuthEventsByTypes(
		missingTypes: string[],
		roomId: string,
	): Promise<Record<string, EventBaseWithOptionalId[]>> {
		const results: Record<string, EventBaseWithOptionalId[]> = {};

		try {
			// Find auth events of the required types in the room
			const authEvents = [];
			const events = await this.eventRepository.findByRoomIdAndTypes(
				roomId,
				missingTypes,
			);
			for await (const event of events) {
				authEvents.push(event);
			}

			// Group events by type
			return authEvents.reduce(
				(acc, event) => {
					if (event.event.type) {
						if (!acc[event.event.type]) {
							acc[event.event.type] = [];
						}
						acc[event.event.type].push(event.event);
					}
					return acc;
				},
				{} as Record<string, EventBaseWithOptionalId[]>,
			);
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.logger.error(`Error fetching auth events by type: ${errorMessage}`);
			return results;
		}
	}

	private async fetchEventsFromFederation(
		eventIds: string[],
		targetServerName: string,
	): Promise<MatrixPDU[]> {
		const eventsToReturn: MatrixPDU[] = [];

		try {
			// TODO: Improve batch event requests to avoid too many parallel requests
			const chunks = this.chunkArray(eventIds, 10);

			for (const chunk of chunks) {
				if (targetServerName === this.configService.getServerName()) {
					this.logger.info(`Skipping request to self: ${targetServerName}`);
					return [];
				}

				const federationResponses = await Promise.all(
					chunk.map((id) =>
						this.federationService.getEvent(targetServerName, id),
					),
				);

				for (const response of federationResponses) {
					// The Matrix spec defines that federation responses may contain PDUs field
					// which is an array of Persistent Data Units (events)
					if (isFederationEventWithPDUs(response)) {
						eventsToReturn.push(...response.pdus);
					}
				}
			}

			return eventsToReturn;
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			this.logger.error(
				`Error fetching events from federation: ${errorMessage}`,
			);
			this.logger.debug(
				`Failed federation request details: ${JSON.stringify({ eventIds, targetServerName })}`,
			);
			return eventsToReturn;
		}
	}

	private chunkArray<T>(array: T[], chunkSize: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += chunkSize) {
			chunks.push(array.slice(i, i + chunkSize));
		}
		return chunks;
	}
}
