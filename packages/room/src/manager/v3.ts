import { toUnpaddedBase64 } from '@hs/crypto';
import { type EventStore, PersistentEventBase } from './event-wrapper';
import type { RoomVersion3To9, RoomVersion10And11 } from './type';
import type { PduVersionForRoomVersion } from './type';

// v3 is where it changes first
export class PersistentEventV3Base<
	T extends RoomVersion3To9 | RoomVersion10And11,
> extends PersistentEventBase<T> {
	private _eventId: string;

	constructor(rawEvent: PduVersionForRoomVersion<T>) {
		super(rawEvent);

		// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-ids
		const referenceHash = this.getReferenceHash();

		// The event ID is the reference hash of the event encoded using Unpadded Base64, prefixed with $. A resulting event ID using this approach should look similar to $CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o.
		this._eventId = `\$${toUnpaddedBase64(referenceHash)}`;
	}

	async getAuthorizationEvents(
		store: EventStore,
	): Promise<PersistentEventBase[]> {
		return store.getEvents(this.rawEvent.auth_events);
	}

	async getPreviousEvents(store: EventStore): Promise<PersistentEventBase[]> {
		return store.getEvents(this.rawEvent.prev_events);
	}
	get eventId(): string {
		return this._eventId;
	}

	// v3 needs backwards compatibility with v1
	transformPowerLevelEventData(data: number | string): number {
		return typeof data === 'number' ? data : Number.parseInt(data, 10);
	}
}

export class PersistentEventV3 extends PersistentEventV3Base<RoomVersion3To9> {}
