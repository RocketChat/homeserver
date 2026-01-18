import type { RoomID } from '@rocket.chat/federation-room';
import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';
import { tracedClass } from '../utils/tracing';

export type Upload = {
	rid: string;
	federation: {
		mxcUri: string;
		mrid: RoomID;
		serverName: string;
		mediaId: string;
	};
};

@tracedClass({ type: 'repository', className: 'UploadRepository' })
@singleton()
export class UploadRepository {
	constructor(
		@inject('UploadCollection') private readonly collection: Collection<Upload>,
	) {}

	async findByMediaId(mediaId: string): Promise<Upload | null> {
		return this.collection.findOne({
			'federation.mediaId': mediaId,
		});
	}
}
