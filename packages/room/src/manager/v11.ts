import { type PduType } from '../types/v3-11';
import { REDACT_ALLOW_ALL_KEYS } from './event-wrapper';
import { PersistentEventV9 } from './v9';

export class PersistentEventV11<
	Type extends PduType = PduType,
> extends PersistentEventV9<Type> {
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
	getAllowedContentKeys(): Record<
		string,
		string[] | typeof REDACT_ALLOW_ALL_KEYS
	> {
		return {
			'm.room.member': ['membership', 'join_authorised_via_users_server'],
			'm.room.create': REDACT_ALLOW_ALL_KEYS,
			'm.room.join_rules': ['join_rule', 'allow'],
			'm.room.power_levels': [
				'ban',
				'events',
				'events_default',
				'invite',
				'kick',
				'redact',
				'state_default',
				'users',
				'users_default',
			],
			'm.room.history_visibility': ['history_visibility'],
			'm.room.redaction': ['redacts'],
		};
	}
}
