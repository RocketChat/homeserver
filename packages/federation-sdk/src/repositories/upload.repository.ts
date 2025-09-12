import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Upload = {
	federation: {
		mxcUri: string;
		serverName: string;
		mediaId: string;
		roomId: string;
	};
};

@singleton()
export class UploadRepository {
	constructor(
		@inject('UploadCollection') private readonly collection: Collection<Upload>,
	) {}

	async findRoomIdByMediaIdAndServerName(
		mediaId: string,
		serverName: string,
	): Promise<string | null> {
		const upload = await this.collection.findOne({
			'federation.mediaId': mediaId,
			'federation.serverName': serverName,
		});

		return upload?.federation.roomId || null;
	}
}
