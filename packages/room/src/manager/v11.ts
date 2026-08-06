import { REDACT_ALLOW_ALL_KEYS } from './event-wrapper';
import type { RedactionEventFields } from './event-wrapper';
import type { RoomVersion } from './type';
import { PersistentEventV9 } from './v9';
import type { EventID, UserID } from '../types/_common';
import { type PduCreateEventContent, type PduRoomRedactionContent, type PduType } from '../types/v3-11';

export class PersistentEventV11<Type extends PduType = PduType> extends PersistentEventV9<Type> {
	// v11 removed m.room.create's content.creator, the sender is the creator instead
	static newCreateEventContent(_creator: UserID, roomVersion: RoomVersion): PduCreateEventContent {
		return { room_version: roomVersion };
	}

	// v11 moved m.room.redaction's redacts from the top level into content
	static newRedactionEventFields(redacts: EventID, content: PduRoomRedactionContent): RedactionEventFields {
		return { content: { ...content, redacts } };
	}

	protected resolveCreator(): UserID {
		return this.sender as UserID;
	}

	protected resolveRedacts(): EventID | undefined {
		return (this.getContent() as PduRoomRedactionContent).redacts;
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
		];
	}

	getAllowedContentKeys(): Record<string, string[] | typeof REDACT_ALLOW_ALL_KEYS> {
		return {
			'm.room.member': ['membership', 'join_authorised_via_users_server'],
			'm.room.create': REDACT_ALLOW_ALL_KEYS,
			'm.room.join_rules': ['join_rule', 'allow'],
			'm.room.power_levels': ['ban', 'events', 'events_default', 'invite', 'kick', 'redact', 'state_default', 'users', 'users_default'],
			'm.room.history_visibility': ['history_visibility'],
			'm.room.redaction': ['redacts'],
		};
	}
}
