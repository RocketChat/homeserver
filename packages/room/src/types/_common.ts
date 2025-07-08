import type { PduType, PduTypeRoomCreate, PduV1 } from './v1';
import type { PduV3 } from './v3';

export type EventID = string;

export type StateKey = string;

export type StateMapKey = `${PduType}:${StateKey}`;

export type State = Map<StateMapKey, EventID>;

export type PduForType<T extends PduType, P extends PduV1 | PduV3> = Extract<
	P extends PduV1 ? PduV1 : PduV3,
	{ type: T }
>;

export type PduV1ForType<T extends PduType> = PduForType<T, PduV1>;

export type PduV3ForType<T extends PduType> = PduForType<T, PduV3>;

export type PduCreate = PduV1ForType<typeof PduTypeRoomCreate>;
