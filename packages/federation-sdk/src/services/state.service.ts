import { createLogger, signEvent } from '@rocket.chat/federation-core';
import {
	type EventID,
	type EventStore,
	type PduContent,
	PduCreateEventContent,
	PduForType,
	type PduType,
	PduWithHashesAndSignaturesOptional,
	type PersistentEventBase,
	PersistentEventFactory,
	RejectCode,
	RoomState,
	RoomVersion,
	type StateID,
	type StateMapKey,
	StateResolverAuthorizationError,
	checkEventAuthWithState,
	extractDomainFromId,
	resolveStateV2Plus,
} from '@rocket.chat/federation-room';
import { singleton } from 'tsyringe';
import { EventRepository } from '../repositories/event.repository';
import { StateGraphRepository } from '../repositories/state-graph.repository';
import { ConfigService } from './config.service';

type State = Map<StateMapKey, PersistentEventBase>;

type StrippedEvent = {
	content: PduContent;
	sender: string;
	state_key?: string;
	type: PduType;
};

/*
 * event -> state id -> state map -> state service
 */

function yieldPairs<T>(list: T[]): [T, T][] {
	const pairs = [] as [T, T][];
	for (let i = 1; i < list.length; i++) {
		pairs.push([list[i - 1], list[i]]);
	}

	return pairs;
}

@singleton()
export class StateService {
	private readonly logger = createLogger('StateService');
	constructor(
		private readonly stateRepository: StateGraphRepository,

		private readonly eventRepository: EventRepository,
		private readonly configService: ConfigService,
	) {}

	// TODO: this is a very vague method, better would be to use exactly what needed,
	// or getCreateEvent.
	// currently AFAIK mostly is used for just room version
	async getRoomInformation(roomId: string): Promise<PduCreateEventContent> {
		const { event, stateId } =
			(await this.eventRepository.findByRoomIdAndType(
				roomId,
				'm.room.create',
			)) ?? {};
		if (event?.type !== 'm.room.create') {
			throw new Error('Create event mapping not found for room information');
		}

		if (!stateId) {
			throw new Error('Create event has no state id, something is very wrong');
		}

		return event.content;
	}

	async getRoomVersion(roomId: string): Promise<RoomVersion> {
		const createEvent = await this.eventRepository.findByRoomIdAndType(
			roomId,
			'm.room.create',
		);
		if (!createEvent) {
			throw new Error('Create event not found for room version');
		}

		return createEvent.event.content?.room_version as RoomVersion;
	}

	// helps with logging state
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

		// TODO: change to debug later
		this.logger.info({ state: printableState }, label);
	}

	private async updateNextEventReferencesWithEvent(event: PersistentEventBase) {
		await this.eventRepository.updateNextEventReferences(
			event.eventId,
			event.getPreviousEventIds(),
		);
	}

	// addToRoomGraph does two things
	// 1. persists the event if not already persisted
	// 2. marks the event as forward extremity for the room
	private async addToRoomGraph(event: PersistentEventBase, stateId: StateID) {
		await this.eventRepository.insertOrUpdateEventWithStateId(
			event.eventId,
			event.event,
			stateId,
		);

		await this.updateNextEventReferencesWithEvent(event);
	}

	// at event isalways the stateId referenced for that event
	private async getStateIdAtEvent(event: PersistentEventBase) {
		const stateId = await this.eventRepository.findStateIdByEventId(
			event.eventId,
		);
		if (!stateId) {
			throw new Error(
				`Event ${event.eventId} not found in db, failed to fidn associated state id`,
			);
		}

		return stateId;
	}

	async getLatestRoomState(roomId: string): Promise<State> {
		const roomVersion = await this.getRoomVersion(roomId);

		const state = await this._mergeDivergentBranches(roomId, roomVersion);
		if (!state) {
			throw new Error(`No state found for room ${roomId}`);
		}

		return state;
	}

	async getLatestRoomState2(roomId: string) {
		const state = await this.getLatestRoomState(roomId);
		return new RoomState(state);
	}

	public async getStrippedRoomState(roomId: string): Promise<StrippedEvent[]> {
		const state = await this.getLatestRoomState(roomId);

		const strippedState: StrippedEvent[] = [];

		for (const event of state.values()) {
			strippedState.push(this.stripEvent(event));
		}

		return strippedState;
	}

	private stripEvent(event: PersistentEventBase): StrippedEvent {
		return {
			content: event.getContent(),
			sender: event.sender,
			state_key: event.stateKey,
			type: event.type,
		};
	}

	async getEvent(eventId: EventID) {
		const event = await this.eventRepository.findById(eventId);
		if (!event) {
			return null;
		}

		const roomVersion = await this.getRoomVersion(event.event.room_id);

		const pdu = PersistentEventFactory.createFromRawEvent(
			event.event,
			roomVersion,
		);

		if (event.rejectCode !== undefined) {
			pdu.reject(
				event.rejectCode,
				event.rejectDetail?.reason ?? '',
				event.rejectDetail?.rejectedBy,
			);
		}

		return pdu;
	}

	public _getStore(roomVersion: RoomVersion): EventStore {
		const cache = new Map<string, PersistentEventBase>();

		return {
			getEvents: async (
				eventIds: EventID[],
			): Promise<PersistentEventBase[]> => {
				if (eventIds.length === 0) {
					return [];
				}

				this.logger.debug({ eventIds }, 'fetching from db or cache');
				const events = [];
				const toFind: EventID[] = [];

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
						event.event,
						roomVersion,
					);
					if (event.rejectCode) {
						e.reject(
							event.rejectCode,
							event.rejectDetail?.reason ?? '',
							event.rejectDetail?.rejectedBy ?? ('' as EventID),
						);
					}
					cache.set(e.eventId, e);
					return e;
				});

				return events.concat(eventsFromStore);
			},
		};
	}

	async buildEvent<T extends PduType>(
		event: PduWithHashesAndSignaturesOptional<PduForType<T>>,
		roomVersion: RoomVersion,
	): Promise<PersistentEventBase<RoomVersion, T>> {
		const instance = PersistentEventFactory.createFromRawEvent<T>(
			event,
			roomVersion,
		);
		await Promise.all([
			instance.event.auth_events.length === 0 && this.addAuthEvents(instance),
			instance.event.prev_events.length === 0 && this.addPrevEvents(instance),
		]);
		await this.signEvent(instance);

		return instance;
	}

	private async addAuthEvents(event: PersistentEventBase) {
		const state = await this.getLatestRoomState(event.roomId);

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

		const prevEvents = await this.eventRepository.findLatestEvents(
			event.roomId,
		);

		for (const prevEvent of prevEvents) {
			const e = PersistentEventFactory.createFromRawEvent(
				prevEvent.event,
				roomVersion,
			);
			event.addPrevEvents([e]);
		}
	}

	public async signEvent<T extends PersistentEventBase>(event: T) {
		if (process.env.NODE_ENV === 'test') return event;

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

	private buildStateFromEvents(events: PersistentEventBase[]): State {
		const state = new Map<StateMapKey, PersistentEventBase>();
		for (const event of events) {
			state.set(event.getUniqueStateIdentifier(), event);
		}
		return state;
	}

	private async buildStateFromStateMap(
		stateMap: Map<StateMapKey, EventID>,
		roomVersion: RoomVersion,
	) {
		if (stateMap.size === 0) {
			throw new Error('State map is empty, cannot build state');
		}

		const eventIds = stateMap.values().toArray();

		const events = await this.eventRepository.findByIds(eventIds).toArray();
		const state = new Map<StateMapKey, PersistentEventBase>();
		for (const event of events) {
			const e = PersistentEventFactory.createFromRawEvent(
				event.event,
				roomVersion,
			);
			state.set(e.getUniqueStateIdentifier(), e);
		}
		return state;
	}

	async saveRejectedEvent(event: PersistentEventBase, stateId: StateID) {
		if (!event.rejectCode) {
			throw new Error('Event is not rejected, no reject reason found in pdu');
		}

		await this.eventRepository.rejectEvent(
			event.eventId,
			event.event,
			stateId,
			event.rejectCode as RejectCode,
			event.rejectReason ?? 'unknown',
			event.rejectedBy,
		);
	}

	// handle received pdu from transaction
	// implements spec:https://spec.matrix.org/v1.12/server-server-api/#checks-performed-on-receipt-of-a-pdu
	// TODO: this is not state related, can and should accept timeline events too, move to event service?
	async handlePdu(event: PersistentEventBase): Promise<void> {
		const exists = await this.eventRepository.findById(event.eventId);
		if (exists) {
			this.logger.debug(
				{ eventId: event.eventId },
				'event exists but attempted to persist again, should not happen',
			);
			return;
		}

		this.logger.debug(
			{ eventId: event.eventId, ...this.stripEvent(event) },
			'handling pdu',
		);

		// handle create events separately
		if (event.isCreateEvent()) {
			this.logger.debug({ eventId: event.eventId }, 'handling create event');
			const stateId = await this.stateRepository.createDelta(
				event,
				'' as StateID,
			);

			await this.addToRoomGraph(event, stateId);

			return;
		}

		// TODO: 1. Is a valid event, otherwise it is dropped. For an event to be valid, it must contain a room_id, and it must comply with the event format of that room version.
		// 2. Passes signature checks, otherwise it is dropped.
		// ^ done someplace else. move here? TODO:
		// 3. Passes hash checks, otherwise it is redacted before being processed further. same as 2
		// 4. Passes authorization rules based on the event’s auth events, otherwise it is rejected.

		const store = this._getStore(event.version);

		const authEvents = await store.getEvents(event.getAuthEventIds());

		try {
			await checkEventAuthWithState(
				event,
				this.buildStateFromEvents(authEvents),
				this._getStore(event.version),
			);
		} catch (error) {
			if (error instanceof StateResolverAuthorizationError) {
				this.logger.warn({ error: error }, 'event not authorized');
				event.reject(error.code, error.reason, error.rejectedBy);

				// at this point potentially there is no state for this event, logic same
				// as for any state at event.
				// since auth events reject this event, it is also pointless to increase state chains
				// for a state that doesn't NEED to have state
				// latest events filter out rejected events anyway, therefore no need to be afraid of having no state id associated with an event here

				await this.saveRejectedEvent(event, '' as StateID);
				return;
			}

			throw error;
		}

		this.logger.debug(
			{ eventId: event.eventId },
			'event authorized against auth events',
		);

		// 5. Passes authorization rules based on the state before the event, otherwise it is rejected.
		await this._resolveStateAtEvent(event); // it is the assumption that this point forwards this event WILL have a state associated with it

		/*
		 * NOTE(Debdut):
		 * At this point the event was allowed in state AT THE TIME OF IT'S CREATION.
		 * which could make you think why not update the state with this event?
		 * I can not. Because it's not just about THIS part of the state needing change, this change can propagate
		 * a whole lot of changes down the road for all states.
		 * State resolution algorithm is SUPPOSED to handle this. Having two branches, merging them and giving the final correct state.
		 *
		 * When we receive an event out of order, instead of just accepting it, we later pass it through state resoltion,
		 * and this event becomes a new forward extrmity for the state graph.
		 *
		 * Spec does not dictate us having to have consistent state at all times, not to mention the complexity of doing so.
		 * If we try to , this would mean having to replay every single event from the point of this event until the end.
		 *
		 * Given that all events are always checked against latest state, we need to make sure the newest state is correct.
		 */

		// indicates the event was allowed at the state, we should save it as part of that state

		// 6. Passes authorization rules based on the current state of the room, otherwise it is “soft failed”.

		// if event already rejected, can skip soft fail check
		// if we are here, means the event is technically "valid", in other words when the event came into existence, nothing was wrong with it, possibly we received it much later.
		// soft fail check is about if the event even passes auth rules based on current state, if not means, again, event valid, but doesn't matter because current state doesn't allow it, something changed in between, no need to worry about it.

		const roomVersion = event.version;

		this.logger.debug(
			{ eventId: event.eventId },
			'validating against latest state',
		);

		// 6. Passes authorization rules based on the current state of the room, otherwise it is “soft failed”.

		// we in memory figure out what the state is NOW
		const state = await this.getLatestRoomState(event.roomId);

		if (
			state.get(event.getUniqueStateIdentifier())?.eventId === event.eventId
		) {
			// linear, already accepted
			return;
		}

		try {
			await checkEventAuthWithState(event, state, this._getStore(roomVersion));
		} catch (error) {
			if (error instanceof StateResolverAuthorizationError) {
				// soft fail
				// TODO: separate flag for soft fail?
				this.logger.warn({ error }, 'event soft failed');
				event.reject(error.code, error.reason, error.rejectedBy);
				// event must have a state id by this point
				const stateId = await this.getStateIdAtEvent(event);
				await this.saveRejectedEvent(event, stateId);
			}

			throw error;
		}
	}

	// // privating because want to limit events loaded in memory at once for large rooms
	// private async *getMembersOfRoom(roomId: string) {
	// 	const membersFromStateId = await this.getLatestStateIdForRoom(roomId);

	// 	const stateMappingsCursor =
	// 		await this.stateRepository.findByRoomIdAndIdentifiersAndStateId(
	// 			roomId,
	// 			// TODO: why it must to end whit `:` ?
	// 			/^m\.room\.member:/,
	// 			membersFromStateId,
	// 		);

	// 	for await (const stateMapping of stateMappingsCursor) {
	// 		const event = await this.eventRepository.findById(
	// 			stateMapping.delta.eventId,
	// 		);
	// 		if (!event) {
	// 			this.logger.warn(
	// 				{
	// 					eventId: stateMapping.delta.eventId,
	// 					roomId: roomId,
	// 				},
	// 				'event not found for member state mapping, possibly a bug',
	// 			);
	// 			continue;
	// 		}

	// 		const rawEvent = event.event;

	// 		if (
	// 			rawEvent.type === 'm.room.member' &&
	// 			rawEvent.content.membership === 'join'
	// 		) {
	// 			yield rawEvent.state_key;
	// 		}
	// 	}
	// }

	// async getServersInRoom(roomId: string) {
	// 	const servers = new Set<string>();
	// 	for await (const member of this.getMembersOfRoom(roomId)) {
	// 		const server = extractDomainFromId(member);
	// 		if (server) {
	// 			servers.add(server);
	// 		}
	// 	}

	// 	return servers.values().toArray();
	// }

	async getStateAtStateId(stateId: StateID, roomVersion: RoomVersion) {
		const stateMap = await this.stateRepository.buildStateMapById(stateId);
		if (!stateMap) {
			throw new Error(
				`getStateAtStateId: no state map found for state id ${stateId}`,
			);
		}

		return this.buildStateFromStateMap(stateMap, roomVersion);
	}

	// async getStateBeforeEvent(event: PersistentEventBase): Promise<State> {
	// 	const stateId = await this.getStateIdBeforeEvent(event);
	// 	return this.getStateAtStateId(stateId, event.version);
	// }

	// TODO: i think moving this to repo will help with schema change diff
	async getServersInRoom(roomId: string) {
		const state = await this.getLatestRoomState(roomId);

		const servers = new Set<string>();

		for (const event of state.values()) {
			if (!event.isMembershipEvent() || event.getMembership() !== 'join') {
				continue;
			}

			try {
				const server = extractDomainFromId(event.stateKey as string);
				if (server) {
					servers.add(server);
				}
			} catch (error) {
				this.logger.error(
					{ error, eventId: event.eventId },
					'error extracting server',
				);
			}
		}

		return Array.from(servers);
	}

	private async _isSameChain(stateIds: StateID[]) {
		const stateDocs = await this.stateRepository
			.findByStateIds(stateIds)
			.toArray();

		const chainIds = new Set<string>();
		const depths = new Set<number>();

		for (const stateDoc of stateDocs) {
			chainIds.add(stateDoc.chainId);
			depths.add(stateDoc.depth);
		}

		return (
			chainIds.size === 1 /* same chain */ &&
			depths.size === stateIds.length /* no branches */
		);
	}

	private async _resolveState(
		stateIds: StateID[],
		roomVersion: RoomVersion,
	): Promise<Map<StateMapKey, PersistentEventBase>> {
		if (await this._isSameChain(stateIds)) {
			// pick the latest id from the chain, that's the state to use
			const latestDelta =
				await this.stateRepository.findLatestByStateIds(stateIds);
			if (!latestDelta) {
				throw new Error(`Failed to find latest state id from list ${stateIds}`);
			}

			const state = await this.getStateAtStateId(latestDelta._id, roomVersion);

			return state;
		}

		const stateLists = (
			await Promise.all(
				stateIds
					.values()
					.map((stateId) => this.stateRepository.buildStateMapById(stateId)),
			)
		).reduce(
			(accum, curr) => {
				if (curr) accum.push(curr);
				return accum;
			},
			[] as Map<StateMapKey, EventID>[],
		);

		const states = await Promise.all(
			stateLists.map((eventIdList) =>
				this.buildStateFromStateMap(eventIdList, roomVersion),
			),
		);

		const [state1, ...rest] = states;
		const stateResRequired = [] as typeof states;
		if (rest.every((state) => state.size === state1.size)) {
			// determine first which ones truely diverge
			const keys = Object.keys(state1) as StateMapKey[];
			const paired = yieldPairs(states);
			const firstPair = paired.shift();
			if (!firstPair) {
				// no state?
				throw new Error('unreachable');
			}

			const [first, second] = firstPair;
			if (
				!keys.every(
					(key) => first.get(key)?.eventId === second.get(key)?.eventId,
				)
			) {
				// need resolution
				stateResRequired.push(first, second);
			}

			for (const [first, second] of paired) {
				if (
					!keys.every(
						(key) => first.get(key)?.eventId === second.get(key)?.eventId,
					)
				) {
					// need resolution
					stateResRequired.push(second);
				}
			}
		}

		const state = await resolveStateV2Plus(
			states, // FIXME: use required
			this._getStore(roomVersion),
		);

		return state;
	}

	private async _resolveAndSaveState(
		stateIds: StateID[],
		roomVersion: RoomVersion,
	) {
		const state = await this._resolveState(stateIds, roomVersion);

		const stateId = await this.stateRepository.createSnapshot(
			state.values().toArray(),
		);

		return { stateId, state };
	}

	private async _resolveStateAtEvent(event: PersistentEventBase) {
		const events = this.eventRepository.findByIds(event.getPreviousEventIds());
		const stateIds = new Set<StateID>();
		for await (const record of events) {
			stateIds.add(record.stateId);
		}

		if (stateIds.size === 0) {
			this.logger.debug(
				{
					eventId: event.eventId,
					previousEvents: event.getPreviousEventIds(),
					events: events,
				},
				'previous events',
			);
			throw new Error(`no state at event ${event.eventId}`);
		}

		// different stateids, may need to run state resolution
		if (stateIds.size > 1) {
			const { stateId, state } = await this._resolveAndSaveState(
				stateIds.values().toArray(),
				event.version,
			);

			// save the event with this state
			// this is more like "state before event"
			// but for timeline events, it's all the same
			await this.addToRoomGraph(event, stateId);
			try {
				await checkEventAuthWithState(
					event,
					state,
					this._getStore(event.version),
				);
			} catch (error) {
				if (error instanceof StateResolverAuthorizationError) {
					event.reject(error.code, error.reason, error.rejectedBy);
					// reject the event but save with the stateid already set, technically not needed anymore
					await this.saveRejectedEvent(event, stateId);
				}

				throw error;
			}

			// move pointer forward for state events
			if (event.isState()) {
				const deltaId = await this.stateRepository.createDelta(event, stateId);
				await this.stateRepository.updateStateIdByEventId(
					event.eventId,
					deltaId,
				);
			}

			return;
		}

		// one state, check auth against it

		const [stateId] = stateIds.values().toArray();
		if (!stateId) {
			throw new Error('unreachable');
		}
		const state = await this.getStateAtStateId(stateId, event.version);
		const authState = new Map<StateMapKey, PersistentEventBase>();
		for (const key of event.getAuthEventStateKeys()) {
			const authEvent = state.get(key);
			if (authEvent) {
				authState.set(authEvent.getUniqueStateIdentifier(), authEvent);
			}
		}

		const authEventIdsInEvent = new Set(event.getAuthEventIds());

		if (
			authEventIdsInEvent.size !== authState.size ||
			authEventIdsInEvent.difference(new Set(authState.values())).size !== 0
		) {
			this.logger.debug(
				{
					authEventsWeHaveSeen: Array.from(authState.values()).map(
						(e) => e.eventId,
					),
					auithEventsInEvent: Array.from(authEventIdsInEvent.values()),
				},
				'auth events differ from event to our state, checking against state',
			);
			try {
				await checkEventAuthWithState(
					event,
					authState,
					this._getStore(event.version),
				);
			} catch (error) {
				if (error instanceof StateResolverAuthorizationError) {
					this.logger.warn({ error }, 'event not authorized against state');
					event.reject(error.code, error.reason, error.rejectedBy);
					// same state, save against it
					await this.saveRejectedEvent(event, stateId);
				}

				throw error;
			}
		}

		this.logger.debug(
			{ eventId: event.eventId, stateId },
			"event authorized against event's state",
		);

		if (event.isTimelineEvent()) {
			// associate the event with the "previous state"
			await this.addToRoomGraph(event, stateId);
		}

		if (event.isState()) {
			// forward the pointer
			const deltaId = await this.stateRepository.createDelta(event, stateId);
			await this.addToRoomGraph(event, deltaId);
		}
	}

	async _mergeDivergentBranches(roomId: string, roomVersion_?: RoomVersion) {
		const roomVersion = roomVersion_
			? roomVersion_
			: await this.getRoomVersion(roomId);
		const records = await this.eventRepository.findLatestEvents(roomId);
		const stateIds = new Set<StateID>();
		for (const record of records) {
			stateIds.add(record.stateId);
		}

		if (stateIds.size === 1) {
			// all pointing to the same state, no need to merge
			const stateId = stateIds.values().toArray()[0]!;
			const stateMap = await this.stateRepository.buildStateMapById(stateId);

			if (!stateMap) {
				throw new Error(`StateService: no state asccociated with ${stateId}`);
			}

			return this.buildStateFromStateMap(stateMap, roomVersion);
		}

		const state = await this._resolveState(
			stateIds.values().toArray(),
			roomVersion,
		);

		// if a new event says any of these events to be a previous event, we need the correct state for the event.
		// can not just update the state each events point to here, we must do it when a new event actually merges these branches
		// this state is not saved

		return state;
	}

	async getStateBeforeEvent(event: PersistentEventBase) {
		const stateId = await this.getStateIdAtEvent(event);

		if (event.isTimelineEvent()) {
			// same as state at event
			const stateMap = await this.stateRepository.buildStateMapById(stateId);
			if (!stateMap) {
				throw new Error(`No state found for event ${event.eventId}`);
			}
			return this.buildStateFromStateMap(stateMap, event.version);
		}

		if (!event.isState()) {
			throw new Error('invalid event type');
		}

		const stateMap =
			await this.stateRepository.buildPreviousStateMapById(stateId);
		if (!stateMap) {
			throw new Error(`No state found for event ${event.eventId}`);
		}

		return this.buildStateFromStateMap(stateMap, event.version);
	}

	async getStateAtEvent(event: PersistentEventBase) {
		const stateId = await this.getStateIdAtEvent(event);

		return this.getStateAtStateId(stateId, event.version);
	}

	// TODO: remove this
	async findStateAtEvent(eventId: EventID) {
		const event = await this.getEvent(eventId);
		if (!event) {
			throw new Error(`EVent ${eventId} not found`);
		}

		return this.getStateAtEvent(event);
	}
}
