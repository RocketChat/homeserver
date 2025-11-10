import { createLogger } from '@rocket.chat/federation-core';
import { ConfigService } from './config.service';
import { EventService } from './event.service';

import {
	EventID,
	Pdu,
	PduForType,
	RoomID,
	RoomVersion,
	UserID,
} from '@rocket.chat/federation-room';
import { delay, inject, singleton } from 'tsyringe';
import { UserRepository } from '../repositories/user.repository';
import { StateService } from './state.service';

@singleton()
export class ProfilesService {
	private readonly logger = createLogger('ProfilesService');

	constructor(
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		private readonly stateService: StateService,
		@inject(delay(() => UserRepository))
		private readonly userRepository: UserRepository,
	) {}
	async queryProfile(userId: string): Promise<{
		avatar_url: string;
		displayname?: string;
	} | null> {
		const [username, serverName] = userId.startsWith('@')
			? userId.split(':', 2)
			: [userId, this.configService.serverName];

		if (serverName !== this.configService.serverName) {
			return null;
		}

		const usernameWithoutAt = username.replace('@', '');
		const user = await this.userRepository.findByUsername(usernameWithoutAt);

		if (!user) {
			this.logger.debug(`Local user ${userId} not found in repository`);
			return null;
		}

		// construct MXC URL based on avatarETag (or fallback to username for backwards compatibility)
		// RC stores avatars in GridFS accessed via /avatar/{username}
		// for Matrix, we use the pattern: mxc://{server}/avatar{avatarETag}
		// Using avatarETag ensures remote servers re-fetch when avatar changes
		const avatarIdentifier = user.avatarETag || usernameWithoutAt;
		return {
			avatar_url: `mxc://${this.configService.serverName}/avatar${avatarIdentifier}`,
			displayname: user.name || user.username,
		};
	}

	async queryKeys(
		deviceKeys: Record<string, string>,
	): Promise<{ device_keys: Record<string, string> }> {
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
		const stateService = this.stateService;
		const roomInformation = await stateService.getRoomInformation(roomId);

		const roomVersion = roomInformation.room_version;

		if (!versions.includes(roomVersion)) {
			throw new Error(`Unsupported room version: ${roomVersion}`);
		}

		if (
			!(await this.stateService.getLatestRoomState2(roomId)).isUserInvited(
				userId,
			)
		) {
			throw new Error(`User ${userId} is not invited`);
		}

		const profile = await this.queryProfile(userId);

		const membershipEvent = await stateService.buildEvent<'m.room.member'>(
			{
				type: 'm.room.member',
				content: {
					membership: 'join',
					...(profile?.displayname && { displayname: profile.displayname }),
					...(profile?.avatar_url && { avatar_url: profile.avatar_url }),
				},
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

	async getMissingEvents(
		roomId: RoomID,
		earliestEvents: EventID[],
		latestEvents: EventID[],
		limit = 10,
		minDepth = 0,
	): Promise<{ events: Pdu[] }> {
		return this.eventService.getMissingEvents(
			roomId,
			earliestEvents,
			latestEvents,
			limit,
			minDepth,
		);
	}

	async eventAuth(
		_roomId: RoomID,
		_eventId: EventID,
	): Promise<{ auth_chain: Record<string, string>[] }> {
		return {
			auth_chain: [],
		};
	}
}
