import { inject, injectable } from 'tsyringe';
import type { EventID, StateMapKey } from '@hs/room';
import type { EventStore, PersistentEventBase } from '@hs/room';
import { PersistentEventFactory } from '@hs/room';
import type { RoomVersion } from '@hs/room';
import { resolveStateV2Plus } from '@hs/room';
import type { PduCreateEventContent } from '@hs/room';
import { createLogger, signEvent } from '@hs/core';
import type { StateRepository } from '../repositories/state.repository';
import type { EventRepository } from '../repositories/event.repository';
import { ConfigService } from './config.service';
import { checkEventAuthWithState } from '@hs/room';

type State = Map<StateMapKey, PersistentEventBase>;

@injectable()
export class StateService {
	private readonly logger = createLogger('StateService');
	constructor(
		@inject('StateRepository')
		private readonly stateRepository: StateRepository,
		@inject('EventRepository')
		private readonly eventRepository: EventRepository,
		private readonly configService: ConfigService,
	) {}

	async getRoomInformation(roomId: string): Promise<PduCreateEventContent> {
		const stateCollection = await this.stateRepository.getCollection();

		const createEventMapping = await stateCollection.findOne({
			roomId,
			'delta.identifier': 'm.room.create:',
		});

		if (!createEventMapping) {
			throw new Error('Create event mapping not found for room information');
		}

		const createEvent = await this.eventRepository.findById(
			createEventMapping.delta.eventId,
		);

		if (!createEvent) {
			throw new Error('Create event not found for room information');
		}

		return createEvent?.event.content as PduCreateEventContent;
	}

	async getRoomVersion(roomId: string): Promise<RoomVersion | undefined> {
		const events = await this.eventRepository.getCollection();

		const createEvent = await events.findOne({
			'event.type': 'm.room.create',
			'event.room_id': roomId,
		});
		if (!createEvent) {
			throw new Error('Create event not found for room version');
		}

		return createEvent.event.content?.room_version as RoomVersion;
	}

	async findStateAtEvent(eventId: string): Promise<State> {
		const event = await this.eventRepository.findById(eventId);

		if (!event) {
			throw new Error(`Event ${eventId} not found`);
		}

		const roomVersion = await this.getRoomVersion(event.event.room_id);
		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		const { stateId } = event;

		const { delta: lastStateDelta, prevStateIds = [] } =
			(await this.stateRepository.getStateMapping(stateId)) ?? {};

		if (!lastStateDelta) {
			throw new Error(`State at event ${eventId} not found`);
		}

		if (prevStateIds.length === 0) {
			const state = new Map<StateMapKey, PersistentEventBase>();
			const { identifier: stateKey, eventId: _lastStateEventId } =
				lastStateDelta;
			const event = await this.eventRepository.findById(eventId);
			if (!event) {
				throw new Error(`Event ${eventId} not found`);
			}

			state.set(
				stateKey as StateMapKey,
				PersistentEventFactory.createFromRawEvent(
					event.event as any /* TODO: fix this with type unifi */,
					roomVersion,
				),
			);

			return state;
		}

		const stateMappings =
			await this.stateRepository.getStateMappingsByStateIdsOrdered(
				prevStateIds,
			);

		const state = new Map<StateMapKey, PersistentEventBase>();

		for await (const { delta } of stateMappings) {
			const { identifier: stateKey, eventId } = delta;
			const event = await this.eventRepository.findById(eventId);
			if (!event) {
				throw new Error(`Event ${eventId} not found`);
			}

			state.set(
				stateKey as StateMapKey,
				PersistentEventFactory.createFromRawEvent(
					event.event as any /* TODO: fix this with type unifi */,
					roomVersion,
				),
			);
		}

		// update the last state
		const { identifier: lastStateKey, eventId: lastStateEventId } =
			lastStateDelta;

		const lastEvent = await this.eventRepository.findById(lastStateEventId);
		if (!lastEvent) {
			throw new Error(`Event ${lastStateEventId} not found`);
		}

		state.set(
			lastStateKey,
			PersistentEventFactory.createFromRawEvent(
				lastEvent.event as any /* TODO: fix this with type unifi */,
				roomVersion,
			),
		);

		return state;
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

			if (!stateMapping.delta) {
				throw new Error('State mapping delta is empty');
			}
			const { identifier: stateKey, eventId } = stateMapping.delta;

			state.set(stateKey as StateMapKey, eventId);
		}

		const finalState = new Map<StateMapKey, PersistentEventBase>();

		for (const [stateKey, eventId] of state) {
			const event = await this.eventRepository.findById(eventId);
			if (!event) {
				throw new Error('Event not found');
			}

			const pdu = PersistentEventFactory.createFromRawEvent(
				event.event as any,
				roomVersion,
			);

			if (pdu.eventId !== eventId) {
				throw new Error('Event id mismatch in trying to room state');
			}

			finalState.set(stateKey as StateMapKey, pdu);
		}

		return finalState;
	}

	public _getStore(roomVersion: RoomVersion): EventStore {
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
				_hashes: string[],
			): Promise<PersistentEventBase[]> => {
				throw new Error('Not implemented');
			},
		};
	}

	async *getAuthEvents(event: PersistentEventBase) {
		const state = await this.getFullRoomState(event.roomId);

		const eventsNeeded = event.getAuthEventStateKeys();

		for (const stateKey of eventsNeeded) {
			const authEvent = state.get(stateKey);
			if (authEvent) {
				yield authEvent;
			}
		}
	}

	async *getPrevEvents(event: PersistentEventBase) {
		const roomVersion = await this.getRoomVersion(event.roomId);
		if (!roomVersion) {
			throw new Error('Room version not found while filling prev events');
		}

		const prevEvents = await this.eventRepository.findPrevEvents(event.roomId);

		for (const prevEvent of prevEvents) {
			yield PersistentEventFactory.createFromRawEvent(
				prevEvent.event as any,
				roomVersion,
			);
		}
	}

	public async signEvent(event: PersistentEventBase) {
		const signingKey = await this.configService.getSigningKey();

		const origin = this.configService.getServerName();

		const result = await signEvent(
			// Before signing the event, the content hash of the event is calculated as described below. The hash is encoded using Unpadded Base64 and stored in the event object, in a hashes object, under a sha256 key.
			// ^^ is done already through redactedEvent fgetter
			// The event object is then redacted, following the redaction algorithm. Finally it is signed as described in Signing JSON, using the server’s signing key (see also Retrieving server keys).
			event.redactedEvent as any,
			signingKey[0],
			origin,
		);

		const keyId = `${signingKey[0].algorithm}:${signingKey[0].version}`;

		event.addSignature(origin, keyId, result.signatures[origin][keyId]);

		return event;
	}

	private async _persistEventAgainstState(
		event: PersistentEventBase,
		state: State,
	): Promise<void> {
		const roomVersion = event.isCreateEvent()
			? (event.getContent<PduCreateEventContent>().room_version as RoomVersion)
			: await this.getRoomVersion(event.roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		// always check for conflicts at the prev_event state

		// check if has conflicts
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
			await checkEventAuthWithState(event, state, this._getStore(roomVersion));
			if (event.rejected) {
				throw new Error(event.rejectedReason);
			}

			// save the state mapping
			const { insertedId: stateMappingId } =
				await this.stateRepository.createStateMapping(event, prevStateIds);

			const signedEvent = await this.signEvent(event);

			this.eventRepository.create(
				signedEvent.event as any,
				event.eventId,
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
				'',
			);
			return;
		}

		// new state

		const { insertedId: stateMappingId } =
			await this.stateRepository.createStateMapping(
				resolvedEvent,
				prevStateIds,
			);

		const signedEvent = await this.signEvent(resolvedEvent);

		await this.eventRepository.create(
			signedEvent.event as any,
			resolvedEvent.eventId,
			stateMappingId.toString(),
		);
	}

	// checks for conflicts, saves the event along with the new state
	async persistStateEvent(event: PersistentEventBase): Promise<void> {
		const roomVersion = event.isCreateEvent()
			? (event.getContent<PduCreateEventContent>().room_version as RoomVersion)
			: await this.getRoomVersion(event.roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		const lastEvent =
			await this.eventRepository.findLatestEventByRoomIdBeforeTimestamp(
				event.roomId,
				event.originServerTs,
			);

		if (!lastEvent) {
			// create
			return this._persistEventAgainstState(event, new Map());
		}

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

		const state = await this.findStateAtEvent(lastEvent.eventId);

		await this._persistEventAgainstState(event, state);

		// if event was not rejected, update local copy
		if (!event.rejected) {
			state.set(event.getUniqueStateIdentifier(), event);
		}

		const restOfTheEvents =
			await this.eventRepository.findEventsByRoomIdAfterTimestamp(
				event.roomId,
				event.originServerTs,
			);

		const conflictedStates = [];

		const conflicts = [];

		for await (const event of restOfTheEvents) {
			const e = PersistentEventFactory.createFromRawEvent(
				event.event as any /* TODO: fix this with type unifi */,
				roomVersion,
			);

			if (state.has(e.getUniqueStateIdentifier())) {
				conflicts.push(e.getUniqueStateIdentifier());
				const conflictedState = new Map(state.entries());
				conflictedState.set(e.getUniqueStateIdentifier(), e);
				conflictedStates.push(conflictedState);
			}
		}

		// if we have any conflicts now, resolve all at once
		if (conflictedStates.length > 0) {
			const resolvedState = await resolveStateV2Plus(
				conflictedStates,
				this._getStore(roomVersion),
			);

			for (const stateKey of conflicts) {
				const resolvedEvent = resolvedState.get(stateKey as StateMapKey);

				if (!resolvedEvent) {
					throw new Error('Resolved event not found, something is wrong');
				}

				const lastStateEvent = state.get(stateKey as StateMapKey);

				if (resolvedEvent.eventId === lastStateEvent?.eventId) {
					// state did not change
					// just persist the event
					// TODO: mark rejected, although no code yet uses it so let it go
					const signedEvent = await this.signEvent(resolvedEvent);

					this.eventRepository.create(
						signedEvent.event as any,
						resolvedEvent.eventId,
						'',
					);

					continue;
				}

				// state changed
				const { insertedId: stateMappingId } =
					await this.stateRepository.createStateMapping(
						resolvedEvent,
						prevStateIds,
					);

				await this.eventRepository.updateStateId(
					resolvedEvent.eventId,
					stateMappingId.toString(),
				);
			}
		}
	}

	async getAllRoomIds() {
		const stateCollection = await this.stateRepository.getCollection();

		const stateMappings = await stateCollection.find({
			'delta.identifier': 'm.room.create:',
		});

		return stateMappings.map((stateMapping) => stateMapping.roomId).toArray();
	}

	async getAllPublicRoomIdsAndNames() {
		const stateCollection = await this.stateRepository.getCollection();

		const eventsCollection = await this.eventRepository.getCollection();

		// all types
		const roomIds = await this.getAllRoomIds();

		const stateMappings = await stateCollection.find({
			'delta.identifier': 'm.room.join_rules:', // those that has this
		});

		const eventsToFetch = await stateMappings
			.map((stateMapping) => stateMapping.delta.eventId)
			.toArray();

		if (eventsToFetch.length === 0) {
			const publicRoomsWithNames = await stateCollection
				.find({
					roomId: { $in: roomIds },
					'delta.identifier': 'm.room.name:',
				})
				.toArray();

			const publicRooms = eventsCollection.find({
				eventId: {
					$in: publicRoomsWithNames.map(
						(stateMapping) => stateMapping.delta.eventId,
					),
				},
			});

			return publicRooms
				.map((event) => ({
					room_id: event.event.room_id,
					name: (event.event.content?.name as string) ?? '',
				}))
				.toArray();
		}

		// TODO: i know thisd is overcomplicated
		//but writing this comment while not remembering what exactkly it does while not wanting to get my brain to do it either

		const nonPublicRooms = await eventsCollection
			.find({
				eventId: { $in: eventsToFetch },
				'event.content.join_rule': { $ne: 'public' },
			})
			.toArray();

		// since no join_rule == public

		const publicRooms = roomIds.filter(
			(roomId) =>
				!nonPublicRooms.some((event) => event.event.room_id === roomId),
		);

		const publicRoomsWithNames = await stateCollection
			.find({
				roomId: { $in: publicRooms },
				'delta.identifier': 'm.room.name:',
			})
			.toArray();

		const publicRoomsWithNamesEvents = eventsCollection.find({
			eventId: {
				$in: publicRoomsWithNames.map(
					(stateMapping) => stateMapping.delta.eventId,
				),
			},
		});

		return publicRoomsWithNamesEvents
			.map((event) => ({
				room_id: event.event.room_id,
				name: (event.event.content?.name as string) ?? '',
			}))
			.toArray();
	}
}
