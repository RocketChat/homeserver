import type { PresenceUpdate } from '@rocket.chat/federation-core';
import {
	createPresenceEDU,
	createTypingEDU,
} from '@rocket.chat/federation-core';
import { createLogger } from '@rocket.chat/federation-core';
import { singleton } from 'tsyringe';
import { ConfigService } from './config.service';
import { FederationService } from './federation.service';
import { StateService } from './state.service';

@singleton()
export class EduService {
	private readonly logger = createLogger('EduService');

	constructor(
		private readonly configService: ConfigService,
		private readonly federationService: FederationService,
		private readonly stateService: StateService,
	) {}

	async sendTypingNotification(
		roomId: string,
		userId: string,
		typing: boolean,
	): Promise<void> {
		try {
			const origin = this.configService.serverName;
			const typingEDU = createTypingEDU(roomId, userId, typing, origin);

			this.logger.debug(
				`Sending typing notification for room ${roomId}: ${userId} (typing: ${typing}) to all servers in room`,
			);

			const servers = await this.stateService.getServersInRoom(roomId);
			const uniqueServers = servers.filter((server) => server !== origin);

			await this.federationService.sendEDUToServers([typingEDU], uniqueServers);

			this.logger.debug(
				`Sent typing notification to ${uniqueServers.length} unique servers for room ${roomId}`,
			);
		} catch (error) {
			this.logger.error({
				msg: 'Failed to send typing notification',
				err: error,
			});
			throw error;
		}
	}

	async sendPresenceUpdateToRooms(
		presenceUpdates: PresenceUpdate[],
		roomIds: string[],
	): Promise<void> {
		try {
			const origin = this.configService.serverName;
			const presenceEDU = createPresenceEDU(presenceUpdates, origin);

			this.logger.debug(
				`Sending presence updates for ${presenceUpdates.length} users to all servers in rooms: ${roomIds.join(', ')}`,
			);
			const uniqueServers = new Set<string>();

			for (const roomId of roomIds) {
				const servers = await this.stateService.getServersInRoom(roomId);
				for (const server of servers) {
					if (server !== origin) {
						uniqueServers.add(server);
					}
				}
			}

			await this.federationService.sendEDUToServers(
				[presenceEDU],
				Array.from(uniqueServers),
			);

			this.logger.debug(
				`Sent presence updates to ${uniqueServers.size} unique servers for ${roomIds.length} rooms`,
			);
		} catch (error) {
			this.logger.error({
				msg: 'Failed to send presence update to rooms',
				err: error,
			});
			throw error;
		}
	}
}
