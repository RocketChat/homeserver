import { BridgeQueryService, NamespaceMatcherService } from '@rocket.chat/appservice';
import { RoomID, UserID } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { DirectoryService } from './directory.service';
import { RoomService } from './room.service';

@singleton()
export class AppServiceRoomService {
	constructor(
		private readonly configService: ConfigService,
		private readonly namespaceMatcherService: NamespaceMatcherService,
		private readonly bridgeQueryService: BridgeQueryService,
		private readonly directoryService: DirectoryService,
		private readonly roomService: RoomService,
	) {}

	async joinAppServiceRoom(roomAlias: string, sender: UserID) {
		const fullRoomAlias = `#${roomAlias}:${this.configService.serverName}`;

		const interested = this.namespaceMatcherService.getInterestedAppServices('', sender, [fullRoomAlias], []);

		let joined = false;

		for await (const as of interested) {
			const claimed = await this.bridgeQueryService.queryRoomAlias(as.registration._id, fullRoomAlias);
			if (!claimed) {
				// Bridge declined the alias or was unreachable (errors are swallowed and
				// logged inside queryRoomAlias). Skip it rather than resolving a room it
				// never created.
				continue;
			}

			const resolved = await this.directoryService.resolveAlias(roomAlias);
			if (!resolved) {
				throw new Error(`Failed to resolve room alias ${roomAlias} after bridge query response`);
			}

			await this.roomService.joinUser(resolved.roomId as RoomID, sender);
			joined = true;
		}

		if (!joined) {
			throw new Error(`No application service was able to provision room alias ${roomAlias}`);
		}
	}
}
