import type { PduType, PduTypeRoomCreate, Pdu } from './v3-11';

export type EventID = string;

export type StateKey = string;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;

export type PduForType<P extends PduType> = Extract<Pdu, { type: P }>;

export type PduCreate = PduForType<typeof PduTypeRoomCreate>;
