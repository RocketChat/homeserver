import type { PduV1 } from '../types/v1';
import type { PduV3 } from '../types/v3';
import type { PduV10 } from '../types/v10';

export type RoomVersion1And2 = '1' | '2';

export type RoomVersion3To9 = '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type RoomVersion10And11 = '10' | '11';

export type RoomVersion =
	| RoomVersion1And2
	| RoomVersion3To9
	| RoomVersion10And11;

export type PduVersionForRoomVersion<T extends RoomVersion> =
	T extends RoomVersion1And2
		? PduV1
		: T extends RoomVersion3To9
			? PduV3
			: T extends RoomVersion10And11
				? PduV10
				: never;

export type PduVersionForRoomVersionWithOnlyRequiredFields<
	T extends RoomVersion,
> = Omit<PduVersionForRoomVersion<T>, 'hashes' | 'signatures' | 'event_id'> & {
	hashes?: PduVersionForRoomVersion<T>['hashes'];
	signatures?: PduVersionForRoomVersion<T>['signatures'];
	event_id?: string;
};
