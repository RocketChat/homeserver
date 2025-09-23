import { EventID, Pdu, PduForType } from '@rocket.chat/federation-room';
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
	stateId: string;
	// for prev_events
	nextEventId: string;
}

export interface EventStagingStore extends PersistentEventBase {
	roomId: string;
}

export interface FetchedEvents {
	events: { eventId: string; event: CoreEventBase }[];
	missingEventIds: string[];
}
