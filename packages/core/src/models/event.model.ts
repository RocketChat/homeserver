import type { EventBase as CoreEventBase } from '../events/eventBase';

// TODO: use room package

export interface EventBaseWithOptionalId extends CoreEventBase {
	event_id?: string;
}

export interface EventStore {
	_id: string;
	event: EventBaseWithOptionalId;

	// TODO: remove the duplication of fields
	staged?: boolean;
	is_staged?: boolean;

	// TODO: check if this is needed or if we should create a new interface
	missing_dependencies?: string[];

	outlier?: boolean;

	stateId: string;
	createdAt: Date;

	// for prev_events
	nextEventId: string;
}

export interface StateEvent extends EventBaseWithOptionalId {
	state_key: string;
}

export interface MessageEvent extends EventBaseWithOptionalId {
	content: {
		msgtype: string;
		body: string;
		[key: string]: unknown;
	};
}

export interface FetchedEvents {
	events: { eventId: string; event: EventBaseWithOptionalId }[];
	missingEventIds: string[];
}
