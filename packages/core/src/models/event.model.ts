import type { EventID, Pdu, RejectCode, RoomID, StateID } from '@rocket.chat/federation-room';

import type { EventBase as CoreEventBase } from '../events/eventBase';

// TODO: use room package

interface PersistentEventBase<E = Pdu> {
	_id: EventID;
	event: E;

	origin: string;

	// TODO: check if this is needed or if we should create a new interface
	missing_dependencies?: string[];

	outlier?: boolean;

	createdAt: Date;
}

// TODO: Merge with StagedEvent from event.service.ts
export interface EventStore<E = Pdu> extends PersistentEventBase<E> {
	// only stored for rooms with domainless ids (v12+), whose create event has no event.room_id
	roomId?: RoomID;

	stateId: StateID;
	// for prev_events
	nextEventId: EventID | '';

	rejectCode?: RejectCode;
	rejectDetail?: {
		reason: string;
		rejectedBy?: EventID;
	};

	partial: boolean;
}

export interface EventStagingStore extends PersistentEventBase {
	roomId: string;
	got: number;
	from: 'join' | 'transaction';
}

export interface FetchedEvents {
	events: { eventId: string; event: CoreEventBase }[];
	missingEventIds: string[];
}
