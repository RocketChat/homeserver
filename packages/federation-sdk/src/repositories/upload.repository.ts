import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type Upload = {
	rid: string;
	federation: {
		mxcUri: string;
		serverName: string;
		mediaId: string;
	};
};

@singleton()
export class UploadRepository {
	constructor(
		@inject('UploadCollection') private readonly collection: Collection<Upload>,
	) {}

	async findRocketChatRoomIdByMediaId(mediaId: string): Promise<string | null> {
		const upload = await this.collection.findOne({
			'federation.mediaId': mediaId,
		});

		return upload?.rid || null;
	}
}
