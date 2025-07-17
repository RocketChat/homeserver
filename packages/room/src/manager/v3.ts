import {
	type EventStore,
	PersistentEventBase,
	REDACT_ALLOW_ALL_KEYS,
} from './event-wrapper';
import type { RoomVersion3To11 } from './type';
import {
	type EventStore,
	PersistentEventBase,
	REDACT_ALLOW_ALL_KEYS,
} from './event-wrapper';
import type { RoomVersion3To11 } from './type';
import { toUnpaddedBase64 } from '@hs/crypto';
import {
	PduTypeRoomAliases,
	PduTypeRoomCreate,
	PduTypeRoomHistoryVisibility,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
} from '../types/v3-11';

// v3 is where it changes first
export class PersistentEventV3 extends PersistentEventBase<RoomVersion3To11> {
	async getAuthorizationEvents(store: EventStore) {
		return store.getEvents(this.rawEvent.auth_events);
	}

	async getPreviousEvents(store: EventStore) {
		return store.getEvents(this.rawEvent.prev_events);
	}
	get eventId(): string {
		// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-ids
		const referenceHash = this.getReferenceHash();

		// The event ID is the reference hash of the event encoded using Unpadded Base64, prefixed with $. A resulting event ID using this approach should look similar to $CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o.
		return `\$${toUnpaddedBase64(referenceHash, { urlSafe: true })}`;
	}

	getAllowedKeys(): string[] {
		return [
			'event_id',
			'type',
			'room_id',
			'sender',
			'state_key',
			'hashes',
			'signatures',
			'depth',
			'prev_events',
			'auth_events',
			'origin_server_ts',
			'origin',
			'prev_state',
			'membership',
		];
	}

	getAllowedContentKeys(): Record<
		string,
		string[] | typeof REDACT_ALLOW_ALL_KEYS
	> {
		return {
			[PduTypeRoomCreate]: ['creator'],
			[PduTypeRoomMember]: ['membership'],
			[PduTypeRoomJoinRules]: ['join_rule'],
			[PduTypeRoomPowerLevels]: [
				'users',
				'users_default',
				'events',
				'events_default',
				'state_default',
				'ban',
				'kick',
				'redact',
			],
			[PduTypeRoomAliases]: ['aliases'],
			[PduTypeRoomHistoryVisibility]: ['history_visibility'],
		};
	}
}
