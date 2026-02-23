import { EventID, Pdu, PduForType, RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { StateService } from './state.service';

@singleton()
export class ProfilesService {
	constructor(private readonly configService: ConfigService, private readonly stateService: StateService) {}

	async queryProfile(userId: string): Promise<{
		avatar_url: string;
		displayname: string;
	}> {
		return {
			avatar_url: 'mxc://matrix.org/MyC00lAvatar',
			displayname: userId,
		};
	}

	async queryKeys(deviceKeys: Record<string, string>): Promise<{ device_keys: Record<string, string> }> {
		const keys = Object.keys(deviceKeys).reduce(
			(v, cur) => {
				v[cur] = 'unknown_key';
				return v;
			},

			{} as Record<string, string>,
		);

		return {
			device_keys: keys,
		};
	}

	async getDevices(userId: string): Promise<{
		user_id: string;
		stream_id: number;
		devices: {
			device_id: string;
			display_name: string;
			last_seen_ip: string;
		}[];
	}> {
		return {
			user_id: userId,
			stream_id: 1,
			devices: [],
		};
	}

	async makeJoin(
		roomId: RoomID,
		userId: UserID,
		versions: RoomVersion[], // asking server supports these
	): Promise<{
		event: PduForType<'m.room.member'> & { origin: string };
		room_version: RoomVersion;
	}> {
		const { stateService } = this;
		const roomInformation = await stateService.getRoomInformation(roomId);

		const roomVersion = roomInformation.room_version;

		if (!versions.includes(roomVersion)) {
			throw new Error(`Unsupported room version: ${roomVersion}`);
		}

		if (!(await this.stateService.getLatestRoomState2(roomId)).isUserInvited(userId)) {
			throw new Error(`User ${userId} is not invited`);
		}

		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: { membership: 'join' },
				room_id: roomId,
				state_key: userId,
				auth_events: [],
				depth: 0,
				prev_events: [],
				origin_server_ts: Date.now(),
				sender: userId,
			},
			roomInformation.room_version,
		);

		return {
			room_version: roomVersion,
			event: {
				...membershipEvent.event,
				origin: this.configService.serverName,
			},
		};
	}

	async eventAuth(_roomId: RoomID, _eventId: EventID): Promise<{ auth_chain: Record<string, string>[] }> {
		return {
			auth_chain: [],
		};
	}
}
