import { createLogger } from '@hs/core';
import type { EventBaseWithOptionalId } from '@hs/homeserver/src/models/event.model';
import { injectable } from 'tsyringe';

@injectable()
export class NotificationService {
	private readonly logger = createLogger('NotificationService');

	async notifyClientsOfEvent(
		roomId: string,
		event: EventBaseWithOptionalId,
	): Promise<void> {
		this.logger.debug(
			`Notifying clients about event ${event.event_id || 'unknown'} in room ${roomId}`,
		);

		// In a real implementation, this would:
		// 1. Find all local clients subscribed to the room
		// 2. Send them the event via their sync connection
		// 3. Update any caches or indexes

		this.logger.debug(
			`Clients notified of event ${event.event_id || 'unknown'} in room ${roomId}`,
		);
	}
}
