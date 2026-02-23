import { isFederationEventWithPDUs, createLogger, generateId } from '@rocket.chat/federation-core';
import { EventID, Pdu } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { FederationService } from './federation.service';
import { EventRepository } from '../repositories/event.repository';

export interface FetchedEvents {
	events: { eventId: string; event: Pdu }[];
	missingEventIds: string[];
}

@singleton()
export class EventFetcherService {
	private readonly logger = createLogger('EventFetcherService');

	constructor(
		@inject(delay(() => EventRepository))
		private readonly eventRepository: EventRepository,
		private readonly federationService: FederationService,
		private readonly configService: ConfigService,
	) {}

	public async fetchEventsByIds(eventIds: EventID[], roomId: string, originServer: string): Promise<FetchedEvents> {
		this.logger.debug(`Fetching ${eventIds.length} events for room ${roomId}`);

		if (!eventIds || eventIds.length === 0) {
			return { events: [], missingEventIds: [] };
		}

		// Try to get events from local database
		const localEvents: { eventId: string; event: Pdu }[] = [];

		const dbEventsCursor = this.eventRepository.findByIds(eventIds);
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
		const missingEventIds = eventIds.filter((id) => !localEvents.some((e) => e.eventId === id));
		if (missingEventIds.length > 0) {
			this.logger.debug(
				`Fetching ${missingEventIds.length} missing events from federation ${Array.from(missingEventIds).join(', ')} ${originServer}`,
			);
			const federationEvents = await this.fetchEventsFromFederation(missingEventIds, originServer);

			const federationEventsWithIds = federationEvents.map((e) => ({
				eventId: generateId(e),
				event: e,
			}));

			return {
				events: [...localEvents, ...federationEventsWithIds],
				missingEventIds: missingEventIds.filter((id) => !federationEventsWithIds.some((e) => e.eventId === id)),
			};
		}

		return {
			events: localEvents,
			missingEventIds: [],
		};
	}

	async fetchEventsFromFederation(eventIds: string[], targetServerName: string): Promise<Pdu[]> {
		const eventsToReturn: Pdu[] = [];

		try {
			// TODO: Improve batch event requests to avoid too many parallel requests
			const chunks = this.chunkArray(eventIds, 10);

			for await (const chunk of chunks) {
				if (targetServerName === this.configService.serverName) {
					this.logger.info(`Skipping request to self: ${targetServerName}`);
					return [];
				}

				const federationResponses = await Promise.all(chunk.map((id) => this.federationService.getEvent(targetServerName, id)));

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
			this.logger.error({
				msg: 'Error fetching events from federation',
				err: error,
				eventIds,
				targetServerName,
			});
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
