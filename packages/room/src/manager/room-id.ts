import type { EventID, RoomID } from '../types/_common';

// room ids before v12 are !opaque:server, from v12 on they are the create event id with a ! sigil.
// the shape is all there is to go on before the create event (and so the room version) is known
export function isDomainlessRoomId(roomId: string): boolean {
	return !roomId.includes(':');
}

export function createEventIdFromRoomId(roomId: RoomID): EventID {
	return `$${roomId.slice(1)}` as EventID;
}

export function roomIdFromCreateEventId(eventId: EventID): RoomID {
	return `!${eventId.slice(1)}` as RoomID;
}

export function roomServerName(roomId: string): string | undefined {
	const idx = roomId.indexOf(':');
	if (idx === -1) {
		return undefined;
	}
	return roomId.substring(idx + 1);
}
