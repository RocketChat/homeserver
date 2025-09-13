import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type MatrixBridgedRoom = {
	rid: string; // Rocket.Chat room ID
	mri: string; // Matrix room ID
	fromServer: string;
};

@singleton()
export class MatrixBridgedRoomRepository {
	constructor(
		@inject('MatrixBridgedRoomCollection')
		private readonly collection: Collection<MatrixBridgedRoom>,
	) {}

	async findMatrixRoomId(rocketChatRoomId: string): Promise<string | null> {
		const bridgedRoom = await this.collection.findOne({
			rid: rocketChatRoomId,
		});

		return bridgedRoom?.mri || null;
	}
}
