import { delay, inject, singleton } from 'tsyringe';

import { RoomAliasRepository } from '../repositories/room-alias.repository';

@singleton()
export class DirectoryService {
	constructor(
		@inject(delay(() => RoomAliasRepository))
		private readonly roomAliasRepository: RoomAliasRepository,
	) {}

	async resolveAlias(alias: string) {
		return this.roomAliasRepository.findByAlias(alias);
	}

	async setAlias(alias: string, roomId: string) {
		return this.roomAliasRepository.upsert(alias, roomId);
	}

	async deleteAlias(alias: string) {
		return this.roomAliasRepository.delete(alias);
	}

	async getAliasesForRoom(roomId: string) {
		return this.roomAliasRepository.findByRoomId(roomId);
	}
}
