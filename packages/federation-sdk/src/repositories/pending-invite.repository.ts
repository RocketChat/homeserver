import { EventID, Pdu } from '@hs/room';
import { Collection } from 'mongodb';
import { inject, singleton } from 'tsyringe';

export type PendingInvite = {
	event: Pdu;
	_id: EventID;
	createdAt: Date;
};

@singleton()
export class PendingInviteRepository {
	constructor(
		@inject('PendingInviteCollection')
		private readonly collection: Collection<PendingInvite>,
	) {}

	async add(eventId: EventID, event: Pdu): Promise<void> {
		await this.collection.insertOne({
			_id: eventId,
			event,
			createdAt: new Date(),
		});
	}

	async findByUserIdAndRoomId(
		userId: string,
		roomId: string,
	): Promise<PendingInvite | null> {
		return this.collection.findOne({
			'event.type': 'm.room.member',
			'event.state_key': userId,
			'event.room_id': roomId,
		});
	}

	async remove(eventId: EventID): Promise<void> {
		await this.collection.deleteOne({ _id: eventId });
	}
}
