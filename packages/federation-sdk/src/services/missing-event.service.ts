import { createLogger } from '@rocket.chat/federation-core';

import { EventID } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { EventFetcherService } from './event-fetcher.service';
import { EventService } from './event.service';
import { StateService } from './state.service';

type MissingEventType = {
	eventId: EventID;
	roomId: string;
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

	async fetchMissingEvent(data: MissingEventType): Promise<boolean> {
		const { eventId, roomId, origin } = data;

		const exists = await this.eventService.getEventById(eventId);
		if (exists) {
			this.logger.debug(
				`Event ${eventId} already exists in database (staged or processed), marking as fetched`,
			);
			return true;
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
				return false;
			}

			for (const { event, eventId } of fetchedEvents.events) {
				this.logger.debug(`Persisting fetched missing event ${eventId}`);

				// TODO is there anything else we need to do with missing dependencies from received event?
				await this.eventService.processIncomingPDUs(origin, [event]);
			}

			return true;
		} catch (err: unknown) {
			this.logger.error({
				msg: 'Error fetching missing event',
				eventId,
				err,
			});
			return false;
		}
	}
}
