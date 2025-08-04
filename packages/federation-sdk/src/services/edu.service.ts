import type { PresenceUpdate } from '@hs/core';
import { createPresenceEDU, createTypingEDU } from '@hs/core';
import { createLogger } from '@hs/core';
import { inject, singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { EventEmitterService } from './event-emitter.service';
import { FederationService } from './federation.service';

@singleton()
export class EduService {
	private readonly logger = createLogger('EduService');

	constructor(
		@inject('ConfigService') private readonly configService: ConfigService,
		private readonly federationService: FederationService,
		private readonly eventEmitterService: EventEmitterService,
	) {}

	async sendTypingNotification(
		roomId: string,
		userIds: string[],
	): Promise<void> {
		try {
			const origin = this.configService.getServerName();
			const typingEDU = createTypingEDU(roomId, userIds, origin);

			this.logger.debug(
				`Sending typing notification for room ${roomId}: ${userIds.join(', ')} to all servers in room`,
			);

			await this.federationService.sendEDUToAllServersInRoom(
				[typingEDU],
				roomId,
			);
		} catch (error) {
			this.logger.error(
				`Failed to send typing notification: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	async sendPresenceUpdateToRooms(
		presenceUpdates: PresenceUpdate[],
		roomIds: string[],
	): Promise<void> {
		try {
			const origin = this.configService.getServerName();
			const presenceEDU = createPresenceEDU(presenceUpdates, origin);

			this.logger.debug(
				`Sending presence updates for ${presenceUpdates.length} users to all servers in rooms: ${roomIds.join(', ')}`,
			);

			for (const roomId of roomIds) {
				void this.federationService.sendEDUToAllServersInRoom(
					[presenceEDU],
					roomId,
				);
			}
		} catch (error) {
			this.logger.error(
				`Failed to send presence update to rooms: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	async sendStopTyping(roomId: string): Promise<void> {
		await this.sendTypingNotification(roomId, []);
	}
}
