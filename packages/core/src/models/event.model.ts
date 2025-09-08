import { Pdu, PduForType } from '@hs/room';
import type { EventBase as CoreEventBase } from '../events/eventBase';

// TODO: use room package

// TODO: Merge with StagedEvent from event.service.ts
export interface EventStore<E = Pdu> {
	_id: string;
	event: E;

	origin: string;

	staged?: boolean;

	// TODO: check if this is needed or if we should create a new interface
	missing_dependencies?: string[];

	outlier?: boolean;

	stateId: string;
	createdAt: Date;

	// for prev_events
	nextEventId: string;
}

export interface FetchedEvents {
	events: { eventId: string; event: CoreEventBase }[];
	missingEventIds: string[];
}
