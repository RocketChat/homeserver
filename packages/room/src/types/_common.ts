import type { Pdu, PduType } from './v3-11';

export declare const __brand: unique symbol;

export type Brand<B> = { [__brand]: B };
export type Branded<T, B> = T & Brand<B>;

export type EventID = Branded<string, 'EventID'>;

export type StateKey = string;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;

export type PduForType<P extends PduType = PduType> = Extract<Pdu, { type: P }>;

export type PduCreate = PduForType<'m.room.create'>;
