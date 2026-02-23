import { toUnpaddedBase64 } from '@rocket.chat/federation-crypto';

import { PersistentEventBase } from './event-wrapper';
import type { REDACT_ALLOW_ALL_KEYS } from './event-wrapper';
import type { RoomVersion3To11 } from './type';
import type { EventID } from '../types/_common';
import type { PduType } from '../types/v3-11';

// v3 is where it changes first
export class PersistentEventV3<Type extends PduType = PduType> extends PersistentEventBase<RoomVersion3To11, Type> {
	private _eventId?: EventID;

	get eventId(): EventID {
		if (this._eventId) {
			return this._eventId;
		}

		// SPEC: https://spec.matrix.org/v1.12/rooms/v3/#event-ids
		const referenceHash = this.getReferenceHash();

		// The event ID is the reference hash of the event encoded using Unpadded Base64, prefixed with $. A resulting event ID using this approach should look similar to $CD66HAED5npg6074c6pDtLKalHjVfYb2q4Q3LZgrW6o.
		this._eventId = `\$${toUnpaddedBase64(referenceHash, { urlSafe: true })}` as EventID;
		return this._eventId;
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

	getAllowedContentKeys(): Record<string, string[] | typeof REDACT_ALLOW_ALL_KEYS> {
		return {
			'm.room.create': ['creator'],
			'm.room.member': ['membership'],
			'm.room.join_rules': ['join_rule'],
			'm.room.power_levels': ['users', 'users_default', 'events', 'events_default', 'state_default', 'ban', 'kick', 'redact'],
			'm.room.aliases': ['aliases'],
			'm.room.history_visibility': ['history_visibility'],
		};
	}
}
