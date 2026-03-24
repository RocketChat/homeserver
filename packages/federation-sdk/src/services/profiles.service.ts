import { EventID, extractDomainFromId, Pdu, PduForType, RoomID, RoomVersion, UserID } from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';

import { ConfigService } from './config.service';
import { StateService } from './state.service';
import { UserRepository } from '../repositories/user.repository';

@singleton()
export class ProfilesService {
	constructor(
		private readonly configService: ConfigService,
		private readonly stateService: StateService,
		@inject(delay(() => UserRepository))
		private readonly userRepository: UserRepository,
	) {}

	async queryProfile(userId: string): Promise<{
		avatar_url?: string;
		displayname: string;
	} | null> {
		const domain = extractDomainFromId(userId);
		if (domain !== this.configService.serverName) {
			return null;
		}

		const username = userId.split(':')[0]?.slice(1);

		const user = await this.userRepository.findByUsername(username);

		if (!user) {
			// this.logger.debug(`Local user ${userId} not found in repository`);
			return null;
		}

		return {
			...(user.avatarETag && { avatar_url: `mxc://${this.configService.serverName}/${user.avatarETag}` }),
			displayname: user.name || user.username!, // username is guaranteed to be present if user is found
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

		const profile = await this.queryProfile(userId);
		const content = {
			membership: 'join' as const,
			...(profile?.displayname && { displayname: profile.displayname }),
			...(profile?.avatar_url && { avatar_url: profile.avatar_url }),
		};

		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content,
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
