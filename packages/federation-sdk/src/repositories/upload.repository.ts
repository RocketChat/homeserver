import { RoomID } from '@rocket.chat/federation-room';
import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';
import { traceInstanceMethods } from '../utils/tracing';

export type Upload = {
	rid: string;
	federation: {
		mxcUri: string;
		mrid: RoomID;
		serverName: string;
		mediaId: string;
	};
};

@singleton()
export class UploadRepository {
	constructor(
		@inject('UploadCollection') private readonly collection: Collection<Upload>,
	) {
		// biome-ignore lint/correctness/noConstructorReturn: Intentional proxy wrapper for tracing
		return traceInstanceMethods(this, {
			type: 'homeserver-sdk repository',
			className: 'UploadRepository',
		});
	}

	async findByMediaId(mediaId: string): Promise<Upload | null> {
		return this.collection.findOne({
			'federation.mediaId': mediaId,
		});
	}
}
