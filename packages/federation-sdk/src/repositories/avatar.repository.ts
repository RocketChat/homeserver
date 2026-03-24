import type { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

@singleton()
export class AvatarRepository {
	constructor(@inject('AvatarCollection') private readonly collection: Collection<{ etag: string }>) {}

	async findOneByETag(etag: string): Promise<{ etag: string } | null> {
		return this.collection.findOne<{ etag: string }>({ etag }, { projection: { etag: 1, _id: 0 } });
	}
}
