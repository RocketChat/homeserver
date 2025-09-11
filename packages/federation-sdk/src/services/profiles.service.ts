import { createLogger } from '@hs/core';
import { ConfigService } from './config.service';
import { EventService } from './event.service';

import {
	Pdu,
	PduForType,
	PersistentEventFactory,
	RoomVersion,
	State,
	getAuthChain,
} from '@hs/room';
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
		event: PduForType<'m.room.member'>;
		room_version: string;
	}> {
		const stateService = this.stateService;
		const roomInformation = await stateService.getRoomInformation(roomId);

		const roomVersion = roomInformation.room_version;

		if (!versions.includes(roomVersion)) {
			throw new Error(`Unsupported room version: ${roomVersion}`);
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
			event: membershipEvent.event,
		};
	}

	async getMissingEvents(
		roomId: string,
		earliestEvents: string[],
		latestEvents: string[],
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
		_roomId: string,
		_eventId: string,
	): Promise<{ auth_chain: Record<string, string>[] }> {
		return {
			auth_chain: [],
		};
	}

	async getStateIds(
		roomId: string,
		eventId: string,
	): Promise<{ pdu_ids: string[]; auth_chain_ids: string[] }> {
		try {
			const state = await this.stateService.findStateAtEvent(eventId);

			const pduIds: string[] = [];
			const authChainIds = new Set<string>();

			// Get room version for the store
			const roomVersion = await this.stateService.getRoomVersion(roomId);
			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			// Get the event store
			const store = this.stateService._getStore(roomVersion);

			// Extract state event IDs and collect auth chain IDs
			for (const [, event] of state.entries()) {
				// PersistentEventBase has an eventId getter
				pduIds.push(event.eventId);

				// Get the complete auth chain for this event
				try {
					const authChain = await getAuthChain(event, store);
					for (const authEventId of authChain) {
						authChainIds.add(authEventId);
					}
				} catch (error) {
					this.logger.warn(
						`Failed to get auth chain for event ${event.eventId}:`,
						error,
					);
				}
			}

			return {
				pdu_ids: pduIds,
				auth_chain_ids: Array.from(authChainIds),
			};
		} catch (error) {
			this.logger.error(`Failed to get state IDs for room ${roomId}:`, error);
			throw error;
		}
	}

	async getState(
		roomId: string,
		eventId?: string,
	): Promise<{
		pdus: Record<string, unknown>[];
		auth_chain: Record<string, unknown>[];
	}> {
		try {
			let state: Map<string, any>;

			if (eventId) {
				// Get state at a specific event
				state = await this.stateService.findStateAtEvent(eventId);
			} else {
				// Get current room state
				state = await this.stateService.getFullRoomState(roomId);
			}

			const pdus: Record<string, unknown>[] = [];
			const authChainIds = new Set<string>();

			// Get room version for the store
			const roomVersion = await this.stateService.getRoomVersion(roomId);
			if (!roomVersion) {
				throw new Error('Room version not found');
			}

			// Get the event store
			const store = this.stateService._getStore(roomVersion);

			// Extract state event objects and collect auth chain IDs
			for (const [, event] of state.entries()) {
				if (event && typeof event === 'object') {
					// PersistentEventBase has an event getter that contains the actual event data
					if ('event' in event) {
						pdus.push(event.event);

						// Get the complete auth chain for this event
						try {
							const authChain = await getAuthChain(event, store);
							for (const authEventId of authChain) {
								authChainIds.add(authEventId);
							}
						} catch (error) {
							this.logger.warn(
								`Failed to get auth chain for event ${event.eventId}:`,
								error,
							);
						}
					}
				}
			}

			// Fetch the actual auth event objects
			const authChain: Record<string, unknown>[] = [];
			if (authChainIds.size > 0) {
				try {
					const authEvents = await store.getEvents(Array.from(authChainIds));
					for (const authEvent of authEvents) {
						if (authEvent && 'event' in authEvent) {
							authChain.push(authEvent.event);
						}
					}
				} catch (error) {
					this.logger.warn('Failed to fetch auth event objects:', error);
				}
			}

			return {
				pdus: pdus,
				auth_chain: authChain,
			};
		} catch (error) {
			this.logger.error(`Failed to get state for room ${roomId}:`, error);
			throw error;
		}
	}
}
