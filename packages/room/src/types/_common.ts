import type { PduType } from "./v1";

export type EventID = string;

export type StateKey = string;

export type EventType = string;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;
