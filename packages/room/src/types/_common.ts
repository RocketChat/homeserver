import type { Pdu, PduType } from './v3-11';

export type EventID = string;

export type StateKey = string;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;

export type PduForType<P extends PduType = PduType> = Extract<Pdu, { type: P }>;

export type PduCreate = PduForType<'m.room.create'>;
