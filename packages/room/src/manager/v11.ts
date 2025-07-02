import {
	PduTypeRoomCreate,
	PduTypeRoomHistoryVisibility,
	PduTypeRoomJoinRules,
	PduTypeRoomMember,
	PduTypeRoomPowerLevels,
	PduTypeRoomRedaction,
} from '../types/v1';
import { REDACT_ALLOW_ALL_KEYS } from './event-wrapper';
import { PersistentEventV10 } from './v10';

export class PersistentEventV11 extends PersistentEventV10 {
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
			[PduTypeRoomMember]: ['membership', 'join_authorised_via_users_server'],
			[PduTypeRoomCreate]: REDACT_ALLOW_ALL_KEYS,
			[PduTypeRoomJoinRules]: ['join_rule', 'allow'],
			[PduTypeRoomPowerLevels]: [
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
			[PduTypeRoomHistoryVisibility]: ['history_visibility'],
			[PduTypeRoomRedaction]: ['redacts'],
		};
	}
}
