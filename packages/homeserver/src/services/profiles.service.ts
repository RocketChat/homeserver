import { createLogger } from '../utils/logger';
import { makeJoinEventBuilder } from '../procedures/makeJoin';
import { ConfigService } from './config.service';
import { EventService } from './event.service';
import { RoomService } from './room.service';

import { EventRepository } from '../repositories/event.repository';
import type {
	AuthEvents,
	RoomMemberEvent,
} from '@hs/core/src/events/m.room.member';
import type { EventStore } from '../models/event.model';
import { injectable } from 'tsyringe';

@injectable()
export class ProfilesService {
	private readonly logger = createLogger('ProfilesService');

	constructor(
		private readonly configService: ConfigService,
		private readonly eventService: EventService,
		private readonly roomService: RoomService,
		private readonly eventRepository: EventRepository,
	) {}

	async queryProfile(
		userId: string,
	): Promise<{ avatar_url: string; displayname: string }> {
		return {
			avatar_url: 'mxc://matrix.org/MyC00lAvatar',
			displayname: userId,
		};
	}

	async queryKeys(deviceKeys: Record<string, string>): Promise<any> {
		const keys = Object.keys(deviceKeys).reduce((v, cur) => {
			v[cur] = 'unknown_key';
			return v;
		}, {} as any);

		return {
			device_keys: keys,
		};
	}

	async getDevices(userId: string): Promise<any> {
		return {
			user_id: userId,
			stream_id: 1,
			devices: [],
		};
	}

	async makeJoin(
		roomId: string,
		userId: string,
		version?: string[],
	): Promise<{
		event: RoomMemberEvent;
		room_version: string;
	}> {
		if (!userId.includes(':') || !userId.includes('@')) {
			throw new Error('Invalid sender');
		}
		if (!roomId.includes(':') || !roomId.includes('!')) {
			throw new Error('Invalid room Id');
		}

		const getAuthEvents = async (roomId: string): Promise<AuthEvents> => {
			const authEvents =
				await this.eventRepository.findAuthEventsIdsByRoomId(roomId);
			const eventsDict = authEvents.reduce(
				(acc, event) => {
					const isMemberEvent =
						event.event.type === 'm.room.member' && event.event.state_key;
					if (isMemberEvent) {
						acc[`m.room.member:${event.event.state_key}`] = event._id;
					} else {
						acc[event.event.type] = event._id;
					}

					return acc;
				},
				{} as Record<string, string>,
			);

			return {
				'm.room.create': eventsDict['m.room.create'],
				'm.room.power_levels': eventsDict['m.room.power_levels'],
				'm.room.join_rules': eventsDict['m.room.join_rules'],
				...(eventsDict[`m.room.member:${userId}`]
					? {
							[`m.room.member:${userId}`]:
								eventsDict[`m.room.member:${userId}`],
						}
					: {}),
			};
		};

		const getLastEvent = async (roomId: string): Promise<EventStore | null> =>
			this.eventService.getLastEventForRoom(roomId);

		const makeJoinEvent = makeJoinEventBuilder(getLastEvent, getAuthEvents);
		const serverName = this.configService.getServerConfig().name;

		const versionArray = version ? version : ['1'];

		return makeJoinEvent(roomId, userId, versionArray, serverName);
	}

	async getMissingEvents(
		roomId: string,
		earliestEvents: string[],
		latestEvents: string[],
		limit: number,
	): Promise<any> {
		const events = await this.eventService.getMissingEvents(
			roomId,
			earliestEvents,
			latestEvents,
			limit,
		);
		return events;
	}

	async eventAuth(roomId: string, eventId: string): Promise<any> {
		return {
			auth_chain: [],
		};
	}
}
