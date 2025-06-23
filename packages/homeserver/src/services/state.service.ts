import { injectable } from 'tsyringe';
import { StateRepository } from '../repositories/state.repository';
import { EventRepository } from '../repositories/event.repository';
import type { StateMapKey } from '@hs/room/src/types/_common';
import {
	type EventStore,
	PersistentEventBase,
} from '@hs/room/src/manager/event-wrapper';
import { PersistentEventFactory } from '@hs/room/src/manager/factory';
import type { RoomVersion } from '@hs/room/src/manager/type';
import { resolveStateV2Plus } from '@hs/room/src/state_resolution/definitions/algorithm/v2';
import type { PduCreateEventContent } from '@hs/room/src/types/v1';
import { createLogger } from '../utils/logger';
import { MongoError } from 'mongodb';

type State = Map<StateMapKey, PersistentEventBase>;

@injectable()
export class StateService {
	private readonly logger = createLogger('StateService');
	constructor(
		private readonly stateRepository: StateRepository,
		private readonly eventRepository: EventRepository,
	) {}

	async getRoomVersion(roomId: string): Promise<RoomVersion | undefined> {
		const events = await this.eventRepository.getCollection();

		const createEvent = await events.findOne({
			'event.type': 'm.room.create',
			'event.room_id': roomId,
		});
		if (!createEvent) {
			throw new Error('Create event not found');
		}

		return createEvent.event.content?.room_version as RoomVersion;
	}

	// the final state id of a room
	// always use this to persist an event with it's respective stateId unless the event is rejected
	async getStateIdForRoom(roomId: string): Promise<string> {
		const stateMapping =
			await this.stateRepository.getLatestStateMapping(roomId);

		if (!stateMapping) {
			throw new Error('State mapping not found');
		}

		return stateMapping._id.toString();
	}

	async getFullRoomState(roomId: string): Promise<State> {
		const roomVersion = await this.getRoomVersion(roomId);
		if (!roomVersion) {
			throw new Error('Room version not found, there is no state');
		}

		const stateMappings =
			await this.stateRepository.getStateMappingsByRoomIdOrderedAscending(
				roomId,
			);
		const state = new Map<StateMapKey, string>();

		// first reconstruct the final state
		for await (const stateMapping of stateMappings) {
			if (!stateMapping.delta) {
				throw new Error('State mapping has no delta');
			}

			const [stateKey, eventId] = Object.entries(stateMapping.delta).shift()!;

			state.set(stateKey as StateMapKey, eventId);
		}

		const finalState = new Map<StateMapKey, PersistentEventBase>();

		for (const [stateKey, eventId] of state) {
			const event = await this.eventRepository.findById(eventId);
			if (!event) {
				throw new Error('Event not found');
			}

			finalState.set(
				stateKey as StateMapKey,
				PersistentEventFactory.createFromRawEvent(
					event.event as any,
					roomVersion,
				),
			);
		}

		return finalState;
	}

	private _getStore(roomVersion: RoomVersion): EventStore {
		const cache = new Map<string, PersistentEventBase>();

		return {
			getEvents: async (eventIds: string[]): Promise<PersistentEventBase[]> => {
				const events = [];
				const toFind = [];

				for (const eventId of eventIds) {
					const event = cache.get(eventId);
					if (event) {
						events.push(event);
						continue;
					}

					toFind.push(eventId);
				}

				const eventsFromStore = (
					await this.eventRepository.findByIds(toFind)
				).map((event) => {
					const e = PersistentEventFactory.createFromRawEvent(
						event.event as any /* TODO: fix this with type unifi */,
						roomVersion,
					);
					cache.set(e.eventId, e);
					return e;
				});

				return events.concat(eventsFromStore);
			},

			getEventsByHashes: async (
				hashes: string[],
			): Promise<PersistentEventBase[]> => {
				throw new Error('Not implemented');
			},
		};
	}

	// checks for conflicts, saves the event along with the new state
	async persistStateEvent(event: PersistentEventBase): Promise<void> {
		const roomVersion = event.isCreateEvent()
			? (event.getContent<PduCreateEventContent>().room_version as RoomVersion)
			: await this.getRoomVersion(event.roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		// always check for conflicts at the prev_event state

		// check if has conflicts
		const state = event.isCreateEvent()
			? new Map()
			: await this.getFullRoomState(event.roomId);

		// ^ now we could avoid full state reconstruction with something like "dropped" prop inside the state mapping

		const stateCollection = await this.stateRepository.getCollection();

		const lastState = await stateCollection.findOne(
			{
				roomId: event.roomId,
			},
			{
				sort: {
					createdAt: -1,
				},
			},
		);

		const prevStateIds = lastState?.prevStateIds?.concat(
			lastState?._id?.toString(),
		);

		const hasConflict = state.has(event.getUniqueStateIdentifier());

		if (!hasConflict) {
			// save the state mapping
			const { insertedId: stateMappingId } =
				await this.stateRepository.createStateMapping(event, prevStateIds);

			this.eventRepository.create(
				event.event as any /* TODO: fix this with type unifi */,
				event.eventId,
				undefined,
				stateMappingId.toString(),
			);

			return;
		}

		const conflictedState = new Map(state.entries());
		conflictedState.set(event.getUniqueStateIdentifier(), event);

		const resolvedState = await resolveStateV2Plus(
			[state, conflictedState],
			this._getStore(roomVersion),
		);

		const resolvedEvent = resolvedState.get(event.getUniqueStateIdentifier());

		if (!resolvedEvent) {
			throw new Error('Resolved event not found, something is wrong');
		}

		if (resolvedEvent.eventId !== event.eventId) {
			// state did not change
			// just persist the event
			// TODO: mark rejected, although no code yet uses it so let it go
			this.eventRepository.create(
				resolvedEvent.event as any /* TODO: fix this with type unifi */,
				resolvedEvent.eventId,
				undefined,
				// no stateId should indicate not being part of the timeline
			);
			return;
		}

		// new state

		const { insertedId: stateMappingId } =
			await this.stateRepository.createStateMapping(
				resolvedEvent,
				prevStateIds,
			);

		await this.eventRepository.create(
			resolvedEvent.event as any /* TODO: fix this with type unifi */,
			resolvedEvent.eventId,
			undefined,
			stateMappingId.toString(),
		);
	}
}
