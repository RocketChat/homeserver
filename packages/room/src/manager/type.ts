export type RoomVersion1And2 = '1' | '2';

// the single list of room versions this implementation supports, everything else derives from it
export const SUPPORTED_ROOM_VERSIONS = ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

export type SupportedRoomVersion = (typeof SUPPORTED_ROOM_VERSIONS)[number];

/** @deprecated use SupportedRoomVersion */
export type RoomVersion3To11 = Exclude<SupportedRoomVersion, '12'>;

export type RoomVersion = RoomVersion1And2 | SupportedRoomVersion;

// what changed between room versions, by feature rather than by number, so code outside the
// version classes never has to compare version numbers
export type RoomVersionCapabilities = {
	// v12 dropped the server name from room ids, the room id is the create event's reference hash
	roomIdFormat: 'random-with-domain' | 'create-event-hash';
	// v12 stopped listing m.room.create in auth_events, it is implied by the room id instead
	createEventInAuthEvents: boolean;
	// v12 gives the create sender and additional_creators an infinite power level
	privilegedCreators: boolean;
	stateResolution: 'v2' | 'v2.1';
	// v11 moved m.room.redaction's redacts into content and dropped m.room.create's creator
	redactsInContent: boolean;
};
