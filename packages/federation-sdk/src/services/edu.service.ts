import type { PresenceUpdate, ReceiptEDU } from '@rocket.chat/federation-core';
import { createPresenceEDU, createTypingEDU, createLogger } from '@rocket.chat/federation-core';
import { RoomID } from '@rocket.chat/federation-room';
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

	async sendTypingNotification(roomId: RoomID, userId: string, typing: boolean): Promise<void> {
		try {
			const origin = this.configService.serverName;
			const typingEDU = createTypingEDU(roomId, userId, typing, origin);

			this.logger.debug(`Sending typing notification for room ${roomId}: ${userId} (typing: ${typing}) to all servers in room`);

			const servers = await this.stateService.getServerSetInRoom(roomId);
			const uniqueServers = Array.from(servers).filter((server) => server !== origin);

			await this.federationService.sendEDUToServers([typingEDU], uniqueServers);

			this.logger.debug(`Sent typing notification to ${uniqueServers.length} unique servers for room ${roomId}`);
		} catch (error) {
			this.logger.error({
				msg: 'Failed to send typing notification',
				err: error,
			});
			throw error;
		}
	}

	async sendPresenceUpdateToRooms(presenceUpdates: PresenceUpdate[], roomIds: RoomID[]): Promise<void> {
		try {
			const origin = this.configService.serverName;
			const presenceEDU = createPresenceEDU(presenceUpdates, origin);

			this.logger.debug(`Sending presence updates for ${presenceUpdates.length} users to all servers in rooms: ${roomIds.join(', ')}`);
			const uniqueServers = new Set<string>();

			await Promise.all(
				roomIds.map(async (roomId) => {
					const servers = await this.stateService.getServerSetInRoom(roomId);
					for (const server of servers) {
						if (server !== origin) {
							uniqueServers.add(server);
						}
					}
				}),
			);

			await this.federationService.sendEDUToServers([presenceEDU], Array.from(uniqueServers));

			this.logger.debug(`Sent presence updates to ${uniqueServers.size} unique servers for ${roomIds.length} rooms`);
		} catch (error) {
			this.logger.error({
				msg: 'Failed to send presence update to rooms',
				err: error,
			});
			throw error;
		}
	}

	async sendReadReceipt({
		roomId,
		userId,
		eventIds,
		threadId,
	}: {
		roomId: RoomID;
		userId: string;
		eventIds: string[];
		threadId?: string;
	}): Promise<void> {
		try {
			const origin = this.configService.serverName;
			const receiptEDU: ReceiptEDU = {
				edu_type: 'm.receipt',
				content: {
					[roomId]: {
						'm.read': {
							[userId]: {
								data: {
									ts: Date.now(),
									thread_id: threadId || 'main',
								},
								event_ids: eventIds,
							},
						},
					},
				},
			};

			this.logger.debug(
				`Sending read receipt for user ${userId} in room ${roomId} for events ${eventIds.join(', ')} to all servers in room`,
			);

			const servers = await this.stateService.getServersInRoom(roomId);
			const uniqueServers = servers.filter((server) => server !== origin);

			await this.federationService.sendEDUToServers([receiptEDU], uniqueServers);

			this.logger.debug(`Sent read receipt to ${uniqueServers.length} unique servers for room ${roomId}`);
		} catch (error) {
			this.logger.error({
				msg: 'Failed to send read receipt',
				err: error,
			});
			throw error;
		}
	}
}
