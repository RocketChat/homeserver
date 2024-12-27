import type { EventBase } from "@hs/core/src/events/eventBase";
import type { RoomCreateEvent } from "@hs/core/src/events/m.room.create";

export async function validateRoomCreateEvent(
	event: RoomCreateEvent,
	authMap: Map<string, EventBase>,
) {
	// 1.1 If it has any previous events, reject.
	if (event.prev_events.length > 0) {
		throw new Error("Previous events are not allowed on m.room.create events");
	}
	// 1.2 If the domain of the room_id does not match the domain of the sender, reject.
	if (event.room_id.split(":")[1] !== event.sender.split(":")[1]) {
		throw new Error(
			"The domain of the room_id does not match the domain of the sender",
		);
	}
	// 1.3 If content.room_version is present and is not a recognised version, reject.
	if (event.content.room_version && event.content.room_version !== "10") {
		throw new Error("The room version is not recognized");
	}
	// 1.4 If content has no creator field, reject.
	if (!event.content.creator) {
		throw new Error("The content has no creator field");
	}
	// Otherwise, allow.
	const roomId = event.room_id;

	const authDict = new Map<string, EventBase>();

	const expected_auth_types = [
		"m.room.create",
		"m.room.member",
		"m.room.power_levels",
		"m.room.join_rules",
		"m.room.history_visibility",
		"m.room.guest_access",
	];

	for await (const eventId of event.auth_events) {
		const event = authMap.get(eventId);
		if (!event) {
			throw new Error("Auth event not found");
		}
		if (event.room_id !== roomId) {
			throw new Error("Auth event does not belong to the room");
		}

		// 2.1 have duplicate entries for a given type and state_key pair
		if (authDict.has(eventId)) {
			throw new Error("Duplicate auth event");
		}

		// 2.2 have entries whose type and state_key don’t match those specified by the auth events selection algorithm described in the server specification.
		if (!expected_auth_types.includes(event.type)) {
			throw new Error("Invalid auth event type");
		}

		// Something to reject reason
		authDict.set(eventId, event);
	}

	if ([...authDict.values()].some((event) => event.type === "m.room.create")) {
		throw new Error("m.room.create event is not allowed");
	}
}
