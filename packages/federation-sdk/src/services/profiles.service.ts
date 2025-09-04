import { makeJoinEventBuilder } from '@hs/core';
import { createLogger } from '@hs/core';
import { ConfigService } from './config.service';
import { EventService } from './event.service';

import type { AuthEvents, EventBase, RoomMemberEvent } from '@hs/core';
import type { EventStore } from '@hs/core';
import { PersistentEventFactory, RoomVersion } from '@hs/room';
import { singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { StateService } from './state.service';

@singleton()
export class ProfilesService {
	private readonly logger = createLogger('ProfilesService');

	constructor(
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		// private readonly roomService: RoomService,

		private readonly eventRepository: EventRepository,
		private readonly stateService: StateService,
	) {}
	async queryProfile(userId: string): Promise<{
		avatar_url: string;
		displayname: string;
	}> {
		return {
			avatar_url: 'mxc://matrix.org/MyC00lAvatar',
			displayname: userId,
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
		roomId: string,
		userId: string,
		versions: RoomVersion[], // asking server supports these
	): Promise<{
		event: RoomMemberEvent;
		room_version: string;
	}> {
		const stateService = this.stateService;
		const roomInformation = await stateService.getRoomInformation(roomId);

		const roomVersion = roomInformation.room_version as RoomVersion;

		if (!versions.includes(roomVersion)) {
			throw new Error(`Unsupported room version: ${roomVersion}`);
		}

		const membershipEvent = PersistentEventFactory.newMembershipEvent(
			roomId,
			userId,
			userId,
			'join',
			roomInformation,
		);

		await stateService.addAuthEvents(membershipEvent);
		await stateService.addPrevEvents(membershipEvent);

		return {
			room_version: roomVersion,
			event: membershipEvent.event as any, // TODO(deb): part of aligning event-wrapper types
		};
	}

	async getMissingEvents(
		roomId: string,
		earliestEvents: string[],
		latestEvents: string[],
		limit: number,
	): Promise<{ events: { _id: string; event: EventBase }[] }> {
		return this.eventService.getMissingEvents(
			roomId,
			earliestEvents,
			latestEvents,
			limit,
		);
	}

	async eventAuth(
		_roomId: string,
		_eventId: string,
	): Promise<{ auth_chain: Record<string, string>[] }> {
		return {
			auth_chain: [],
		};
	}
}
