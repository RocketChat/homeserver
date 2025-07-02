import type { EventBase as CoreEventBase } from '@hs/core/src/events/eventBase';

// TODO: use room package

export interface EventBaseWithOptionalId extends CoreEventBase {
	event_id?: string;
}

export interface EventStore {
	_id: string;
	event: EventBaseWithOptionalId;
	staged?: boolean;
	outlier?: boolean;

	stateId: string;
	createdAt: Date;
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
