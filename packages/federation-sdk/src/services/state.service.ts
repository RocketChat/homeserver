import { signEvent } from '@hs/core';
import {
	type PduContent,
	type PduType,
	RoomState,
	type StateMapKey,
} from '@hs/room';
import type { EventStore, PersistentEventBase } from '@hs/room';
import { PersistentEventFactory } from '@hs/room';
import type { RoomVersion } from '@hs/room';
import { resolveStateV2Plus } from '@hs/room';
import type { PduCreateEventContent } from '@hs/room';
import { checkEventAuthWithState } from '@hs/room';
import { inject, singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { StateRepository } from '../repositories/state.repository';
import { createLogger } from '../utils/logger';
import { ConfigService } from './config.service';

type State = Map<StateMapKey, PersistentEventBase>;

type StrippedRoomState = {
	content: PduContent;
	sender: string;
	state_key: string;
	type: PduType;
};

@singleton()
export class StateService {
	private readonly logger = createLogger('StateService');
	constructor(
		@inject('StateRepository')
		private readonly stateRepository: StateRepository,
		@inject('EventRepository')
		private readonly eventRepository: EventRepository,
		@inject('ConfigService') private readonly configService: ConfigService,
	) {}

	async getRoomInformation(roomId: string): Promise<PduCreateEventContent> {
		const state = await this.stateRepository.getByRoomIdAndIdentifier(
			roomId,
			'm.room.create:',
		);
		if (!state) {
			throw new Error('Create event mapping not found for room information');
		}

		const createEvent = await this.eventRepository.findById(
			state.delta.eventId,
		);
		if (!createEvent) {
			throw new Error('Create event not found for room information');
		}

		return createEvent?.event.content as PduCreateEventContent;
	}

	async getRoomVersion(roomId: string): Promise<RoomVersion | undefined> {
		const createEvent = await this.eventRepository.findByRoomIdAndType(
			roomId,
			'm.room.create',
		);
		if (!createEvent) {
			throw new Error('Create event not found for room version');
		}

		return createEvent.event.content?.room_version as RoomVersion;
	}

	private logState(label: string, state: State) {
		const printableState = Array.from(state.entries()).map(([key, value]) => {
			return {
				internalStateKey: key,
				strippedEvent: {
					state_key: value.stateKey,
					sender: value.sender,
					origin: value.origin,
					content: value.getContent(),
				},
			};
		});

		this.logger.debug({ state: printableState }, label);
	}

	async findStateAtEvent(eventId: string): Promise<State> {
		this.logger.debug({ eventId }, 'finding state at event');

		const state = await this.findStateAroundEvent(eventId, true);

		return state;
	}

	async findStateBeforeEvent(eventId: string): Promise<State> {
		return this.findStateAroundEvent(eventId, false);
	}

	private async findStateAroundEvent(
		eventId: string,
		includeEvent = false,
	): Promise<State> {
		this.logger.debug({ eventId }, 'finding state before event');
		const event = await this.eventRepository.findById(eventId);

		if (!event) {
			this.logger.error({ eventId }, 'event not found');
			throw new Error(`Event ${eventId} not found`);
		}

		const roomVersion = await this.getRoomVersion(event.event.room_id);
		if (!roomVersion) {
			this.logger.error({ eventId }, 'room version not found');
			throw new Error('Room version not found');
		}

		const { stateId } = event;

		if (!stateId) {
			this.logger.error({ eventId }, 'state id not found');
			throw new Error('State id not found');
		}

		const { delta: lastStateDelta, prevStateIds = [] } =
			(await this.stateRepository.getStateById(stateId)) ?? {};

		this.logger.debug({ delta: lastStateDelta, prevStateIds }, 'last state');

		if (!lastStateDelta) {
			this.logger.error(eventId, 'last state delta not found');
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

		const stateMappings = await this.stateRepository
			.getStateMappingsByStateIdsOrdered(prevStateIds)
			.toArray();

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

		if (!includeEvent) {
			return state;
		}

		this.logger.debug({ eventId }, 'including event in state');

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
			this.stateRepository.getStateMappingsByRoomIdOrderedAscending(roomId);
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

	async getFullRoomState2(roomId: string): Promise<RoomState> {
		const state = await this.getFullRoomState(roomId);
		return new RoomState(state);
	}

	async getFullRoomStateBeforeEvent2(eventId: string): Promise<RoomState> {
		const state = await this.findStateBeforeEvent(eventId);
		return new RoomState(state);
	}

	public async getStrippedRoomState(
		roomId: string,
	): Promise<StrippedRoomState[]> {
		const state = await this.getFullRoomState(roomId);

		const strippedState: StrippedRoomState[] = [];

		for (const event of state.values()) {
			strippedState.push({
				content: event.getContent(),
				sender: event.sender,
				state_key: event.stateKey as string, // state event
				type: event.type,
			});
		}

		return strippedState;
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

				const resultEventsCursor = this.eventRepository.findByIds(toFind);
				const resultEvents = await resultEventsCursor.toArray();
				const eventsFromStore = resultEvents.map((event) => {
					const e = PersistentEventFactory.createFromRawEvent(
						event.event as any /* TODO: fix this with type unifi */,
						roomVersion,
					);
					cache.set(e.eventId, e);
					return e;
				});

				return events.concat(eventsFromStore);
			},
		};
	}

	async addAuthEvents(event: PersistentEventBase) {
		const state = await this.getFullRoomState(event.roomId);

		const eventsNeeded = event.getAuthEventStateKeys();

		for (const stateKey of eventsNeeded) {
			const authEvent = state.get(stateKey);
			if (authEvent) {
				event.authedBy(authEvent);
			}
		}
	}

	async addPrevEvents(event: PersistentEventBase) {
		const roomVersion = await this.getRoomVersion(event.roomId);
		if (!roomVersion) {
			throw new Error('Room version not found while filling prev events');
		}

		const prevEvents = await this.eventRepository.findPrevEvents(event.roomId);

		for (const prevEvent of prevEvents) {
			const e = PersistentEventFactory.createFromRawEvent(
				prevEvent.event as any,
				roomVersion,
			);
			event.addPreviousEvent(e);
		}
	}

	public async signEvent(event: PersistentEventBase) {
		const signingKey = await this.configService.getSigningKey();

		const origin = this.configService.serverName;

		const result = await signEvent(
			// Before signing the event, the content hash of the event is calculated as described below. The hash is encoded using Unpadded Base64 and stored in the event object, in a hashes object, under a sha256 key.
			// ^^ is done already through redactedEvent fgetter
			// The event object is then redacted, following the redaction algorithm. Finally it is signed as described in Signing JSON, using the server’s signing key (see also Retrieving server keys).
			event.redactedEvent as any,
			signingKey[0],
			origin,
			false, // already passed through redactedEvent, hash is already part of this
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

		const lastState = await this.stateRepository.getLastStateMappingByRoomId(
			event.roomId,
		);

		this.logger.debug(
			{
				stateMappingId: lastState?._id.toString(),
				eventId: lastState?.delta?.eventId,
			},
			'last state mapping',
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

			await this.eventRepository.create(
				signedEvent.event as any,
				event.eventId,
				stateMappingId.toString(),
			);

			return;
		}

		const conflictedState = new Map(state.entries());
		conflictedState.set(event.getUniqueStateIdentifier(), event);

		this.logState('conflicted state', conflictedState);

		const resolvedState = await resolveStateV2Plus(
			[state, conflictedState],
			this._getStore(roomVersion),
		);

		const resolvedEvent = resolvedState.get(event.getUniqueStateIdentifier());

		if (!resolvedEvent) {
			this.logger.error({ msg: 'resolved event not found' });
			throw new Error('Resolved event not found, something is wrong');
		}

		this.logger.debug(
			{
				resolvedEvent: resolvedEvent?.event,
			},
			'resolved event',
		);

		if (resolvedEvent.eventId !== event.eventId) {
			// state did not change, resolvedEvent is an older event
			// just persist the event
			// TODO: mark rejected, although no code yet uses it so let it go
			await this.eventRepository.create(
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
		const exists = await this.eventRepository.findById(event.eventId);
		if (exists) {
			this.logger.debug({ eventId: event.eventId }, 'event already exists');
			return;
		}

		const roomVersion = event.isCreateEvent()
			? (event.getContent<PduCreateEventContent>().room_version as RoomVersion)
			: await this.getRoomVersion(event.roomId);

		if (!roomVersion) {
			throw new Error('Room version not found');
		}

		const lastEvent =
			await this.eventRepository.findLatestEventByRoomIdBeforeTimestampWithAssociatedState(
				event.roomId,
				event.originServerTs,
			);

		this.logger.debug(
			{
				eventId: lastEvent?._id,
				event: lastEvent?.event,
			},
			'last event seen before current event',
		);

		if (!lastEvent) {
			// create
			return this._persistEventAgainstState(event, new Map());
		}

		const lastState = await this.stateRepository.getLastStateMappingByRoomId(
			event.roomId,
		);

		const prevStateIds = lastState?.prevStateIds?.concat(
			lastState?._id?.toString(),
		);

		const state = await this.findStateAtEvent(lastEvent._id);

		this.logState('state at last event seen:', state);

		await this._persistEventAgainstState(event, state);

		// if event was not rejected, update local copy
		if (!event.rejected) {
			this.logger.debug(
				event.eventId,
				'event was accepted against the state at the time of the event creation',
			);
			state.set(event.getUniqueStateIdentifier(), event);
		}

		this.logState('new state', state);

		const restOfTheEvents = await this.eventRepository
			.findEventsByRoomIdAfterTimestamp(event.roomId, event.originServerTs)
			.toArray();

		this.logger.debug(
			{
				events: restOfTheEvents,
			},
			'events seen after passed event',
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

		this.logger.debug({ conflicts }, 'conflicts');

		// if we have any conflicts now, resolve all at once
		if (conflictedStates.length > 0) {
			const resolvedState = await resolveStateV2Plus(
				conflictedStates,
				this._getStore(roomVersion),
			);

			for (const stateKey of conflicts) {
				const resolvedEvent = resolvedState.get(stateKey as StateMapKey);

				this.logger.debug(
					{
						resolvedEvent: resolvedEvent?.event,
					},
					'resolved event',
				);

				if (!resolvedEvent) {
					throw new Error('Resolved event not found, something is wrong');
				}

				const lastStateEvent = state.get(stateKey as StateMapKey);

				if (resolvedEvent.eventId === lastStateEvent?.eventId) {
					// state did not change
					// just persist the event
					// TODO: mark rejected, although no code yet uses it so let it go
					const signedEvent = await this.signEvent(resolvedEvent);

					await this.eventRepository.create(
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
		const stateMappingsCursor =
			this.stateRepository.getStateMappingsByIdentifier('m.room.create:');
		const stateMappings = await stateMappingsCursor.toArray();
		return stateMappings.map((stateMapping) => stateMapping.roomId);
	}

	async persistTimelineEvent(event: PersistentEventBase) {
		const exists = await this.eventRepository.findById(event.eventId);
		if (exists) {
			return;
		}

		if (event.isState()) {
			throw new Error('State events are not persisted with this method');
		}

		const roomVersion = await this.getRoomVersion(event.roomId);
		if (!roomVersion) {
			throw new Error(
				'Room version not found when trying to persist a timeline event',
			);
		}

		const room = await this.getFullRoomState(event.roomId);

		this.logState('state at saving message', room);

		// we need the auth events required to validate this event from our state
		const requiredAuthEventsWeHaveSeenMap = new Map<
			string,
			PersistentEventBase
		>();
		for (const auth of event.getAuthEventStateKeys()) {
			const authEvent = room.get(auth);
			if (authEvent) {
				requiredAuthEventsWeHaveSeenMap.set(authEvent.eventId, authEvent);
			}
		}

		// auth events referenced in the message
		const store = this._getStore(roomVersion);
		const authEventsReferencedInMessage = await store.getEvents(
			event.event.auth_events as string[],
		);
		const authEventsReferencedMap = new Map<string, PersistentEventBase>();
		for (const authEvent of authEventsReferencedInMessage) {
			authEventsReferencedMap.set(authEvent.eventId, authEvent);
		}

		// While auth_events in this timeline event may not be wrong and ones we have seen, they can still point to old state events, and validating against them will fail.
		// by doing this precheck we allow the method to exit quicker.

		// both auth events set must match
		if (requiredAuthEventsWeHaveSeenMap.size !== authEventsReferencedMap.size) {
			// incorrect length may mean either redacted event still referenced or event in state that wasn't referenced, both cases, reject the event
			event.reject(
				`Auth events referenced in message do not match, expected ${requiredAuthEventsWeHaveSeenMap.size} but got ${authEventsReferencedMap.size}`,
			);
			throw new Error(event.rejectedReason);
		}

		for (const [eventId] of requiredAuthEventsWeHaveSeenMap) {
			if (!authEventsReferencedMap.has(eventId)) {
				event.reject(
					`wrong auth event in message, expected ${eventId} but not found in event`,
				);
				throw new Error(event.rejectedReason);
			}
		}

		// now we validate against auth rules
		await checkEventAuthWithState(event, room, store);
		if (event.rejected) {
			throw new Error(event.rejectedReason);
		}

		// TODO: save event still but with mark

		// now we persist the event
		await this.eventRepository.create(
			event.event as any,
			event.eventId,
			'' /* no state id for you */,
		);

		// transactions not handled here, since we can use this method as part of a "transaction receive"
	}

	async getAllPublicRoomIdsAndNames() {
		// all types
		const roomIds = await this.getAllRoomIds();
		const stateMappingsCursor =
			this.stateRepository.getStateMappingsByIdentifier('m.room.join_rules:');
		const stateMappings = await stateMappingsCursor.toArray();
		const eventsToFetch = stateMappings.map(
			(stateMapping) => stateMapping.delta.eventId,
		);

		if (eventsToFetch.length === 0) {
			const publicRoomsWithNamesCursor =
				this.stateRepository.getByRoomIdsAndIdentifier(roomIds, 'm.room.name:');
			const publicRoomsWithNames = await publicRoomsWithNamesCursor.toArray();

			const eventIds = publicRoomsWithNames.map(
				(stateMapping) => stateMapping.delta.eventId,
			);
			const publicRoomsWithNamesEventsCursor =
				this.eventRepository.findByIds(eventIds);
			const publicRoomsWithNamesEvents =
				await publicRoomsWithNamesEventsCursor.toArray();

			return publicRoomsWithNamesEvents.map((event) => ({
				room_id: event.event.room_id,
				name: (event.event.content?.name as string) ?? '',
			}));
		}

		// TODO: i know thisd is overcomplicated
		//but writing this comment while not remembering what exactkly it does while not wanting to get my brain to do it either

		const nonPublicRoomsCursor =
			this.eventRepository.findFromNonPublicRooms(eventsToFetch);
		const nonPublicRooms = await nonPublicRoomsCursor.toArray();

		// since no join_rule == public

		const publicRooms = roomIds.filter(
			(roomId) =>
				!nonPublicRooms.some((event) => event.event.room_id === roomId),
		);

		const publicRoomsWithNamesCursor =
			this.stateRepository.getByRoomIdsAndIdentifier(
				publicRooms,
				'm.room.name:',
			);
		const publicRoomsWithNames = await publicRoomsWithNamesCursor.toArray();

		const eventIds = publicRoomsWithNames.map(
			(stateMapping) => stateMapping.delta.eventId,
		);
		const publicRoomsWithNamesEventsCursor =
			this.eventRepository.findByIds(eventIds);
		const publicRoomsWithNamesEvents =
			await publicRoomsWithNamesEventsCursor.toArray();

		return publicRoomsWithNamesEvents.map((event) => ({
			room_id: event.event.room_id,
			name: (event.event.content?.name as string) ?? '',
		}));
	}

	async getMembersOfRoom(roomId: string) {
		const stateMappingsCursor = this.stateRepository.getByRoomIdsAndIdentifier(
			[roomId],
			/^m\.room\.member:/,
		);
		const stateMappings = await stateMappingsCursor.toArray();

		const eventIds = stateMappings.map(
			(stateMapping) => stateMapping.delta.eventId,
		);
		const eventsCursor = this.eventRepository.findByIds(eventIds);
		const events = await eventsCursor.toArray();

		const members = events
			.filter((event) => event.event.content?.membership === 'join')
			.map((event) => event.event.state_key as string);

		return members;
	}

	async getServersInRoom(roomId: string) {
		return this.getMembersOfRoom(roomId).then((members) =>
			members.map((member) => member.split(':').pop()!),
		);
	}
}
