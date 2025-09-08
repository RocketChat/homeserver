import { Pdu } from '@hs/room';
import type { EventBase } from './eventBase';

export type JoinRule =
	| 'invite'
	| 'knock'
	| 'public'
	| 'restricted'
	| 'knock_restricted';

export type Membership = 'join' | 'invite' | 'leave' | 'knock' | 'ban';

export interface RoomMemberEvent extends EventBase {
	type: 'm.room.member';
	content: {
		membership: Membership;
		join_rule: JoinRule;
		join_authorised_via_users_server?: string;
		third_party_invite?: {
			signed: {
				mxid: string;
				token: string;
				signatures: {
					[servername: string]: {
						[protocol: string]: string;
					};
				};
			};
		};
		reason?: string;
		avatar_url?: string;
		displayname?: string;
	};
	state_key: string;
	unsigned: {
		// TODO: Check what this is
		age: number;
		age_ts: number;
		invite_room_state: (
			| {
					type: 'm.room.join_rules';
					state_key: '';
					content: { join_rule: 'invite' };
					sender: string;
			  }
			| {
					type: 'm.room.create';
					state_key: '';
					content: { room_version: '10'; creator: string };
					sender: string;
			  }
			| {
					type: 'm.room.member';
					state_key: string;
					content: { displayname: 'admin'; membership: 'join' };
					sender: string;
			  }
			| {
					type: 'm.room.name';
					state_key: '';
					content: { name: string };
					sender: string;
			  }
		)[];
	};
}

export const isRoomMemberEvent = (event: Pdu): event is RoomMemberEvent => {
	return event.type === 'm.room.member';
};
