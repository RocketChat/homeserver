export type EventID = string;

export type StateKey = string;

export type EventType = string;

export type StateMapKey = `${EventType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;
