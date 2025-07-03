import type { PduV1 } from '../types/v1';
import type { PduV3 } from '../types/v3';

export type RoomVersion1And2 = '1' | '2';

export type RoomVersion3To11 =
	| '3'
	| '4'
	| '5'
	| '6'
	| '7'
	| '8'
	| '9'
	| '10'
	| '11';

export type RoomVersion = RoomVersion1And2 | RoomVersion3To11;

export type PduVersionForRoomVersion<T extends RoomVersion> =
	T extends RoomVersion1And2
		? PduV1
		: T extends RoomVersion3To11
			? PduV3
			: never;
