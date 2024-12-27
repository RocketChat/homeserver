import type { EventBase } from "@hs/core/src/events/eventBase";
import { generateId } from "../../authentication";
import type { EventStore } from "../../plugins/mongodb";
import { isRoomCreateEvent } from "@hs/core/src/events/m.room.create";
import {
	type RoomMemberEvent,
	isRoomMemberEvent,
} from "@hs/core/src/events/m.room.member";
import {
	type PowerLevelNames,
	isRoomPowerLevelsEvent,
} from "@hs/core/src/events/m.room.power_levels";
import { validateRoomCreateEvent } from "./validateRoomCreateEvent";
import { validateRoomMemberEvent } from "./validateRoomMemberEvent";
import { validateRoomPowerLevelsEvent } from "./validateRoomPowerLevelsEvent";

const difference = (a: string[], b: string[]) =>
	a.filter((x) => !b.includes(x));
const getMissingEvents = (a: string[]) => [];

// https://spec.matrix.org/v1.2/rooms/v9/#authorization-rules

export const ensureAuthorizationRulesBatch = function* (
	events: EventBase[],
	roomId: string,
	size = 100,
) {
	const array = [...events];
	while (array.length) {
		yield ensureAuthorizationRules(array.splice(0, size), roomId);
	}
};

export const ensureAuthorizationRulesAndStoreBatch = async (
	events: {
		insertMany: (events: EventStore[]) => Promise<void>;
	},
	authChain: EventBase[],
	roomId: string,
	size = 100,
) => {
	for await (const eventsToBeStored of ensureAuthorizationRulesBatch(
		authChain,
		roomId,
		size,
	)) {
		await events.insertMany(
			[...eventsToBeStored.entries()].map(([key, event]) => ({
				_id: key,
				event,
				outlier: true,
			})),
		);
	}
};

export const ensureAuthorizationRules = async (
	events: EventBase[],
	roomId: string,
) => {
	const eventMap = new Map(events.map((event) => [generateId(event), event]));
	const eventKeys = Array.from(eventMap.keys());
	const seenRemoteEvents = new Set<EventStore>(); // get from database
	for (const seen of seenRemoteEvents) {
		eventMap.delete(seen._id);
	}

	const authGraph = new Map(
		[...eventMap.entries()].map(([id, event]) => {
			return [id, event.auth_events.filter((eventId) => eventMap.get(eventId))];
		}),
	);

	// // TODO: sorted_topologically
	const sortedAuthEventsIds = [...authGraph.values()];
	const sortedAuthEvents = [...authGraph.entries()]
		.map(([key]) => eventMap.get(key))
		.filter(Boolean) as EventBase[];

	const authEventIds = sortedAuthEvents.flatMap((event) => event.auth_events);

	const authMap = new Map(
		sortedAuthEvents
			.filter((event) => authEventIds.includes(generateId(event)))
			.map((event) => [generateId(event), event]),
	);

	const missingEventsId = difference(authEventIds, [...authMap.keys()]);

	if (!missingEventsId.length) {
		const missingEvents = getMissingEvents(missingEventsId);
		for (const event of missingEvents) {
			eventMap.set(generateId(event), event);
		}
	}

	const eventsToBeStored = new Map<string, EventBase>();
	for await (const event of sortedAuthEvents) {
		try {
			if (await checkEventAuthorization(event, authMap)) {
				eventsToBeStored.set(generateId(event), event);
			}
		} catch (e) {
			console.log("error", e);
		}
	}

	return eventsToBeStored;
};

export async function checkEventAuthorization(
	event: EventBase,
	authMap: Map<string, EventBase>,
) {
	const authEvents = new Map<string, EventBase>();
	for (const authEventId of event.auth_events) {
		const ae = authMap.get(authEventId);
		if (!ae) {
			// The fact we can't find the auth event doesn't mean it doesn't
			// exist, which means it is premature to reject `event`. Instead, we
			// just ignore it for now.
			console.log(
				`Dropping event ${generateId(event)}, which relies on auth_event ${authEventId}, which could not be found`,
			);
			return;
		}
		authEvents.set(authEventId, ae);
	}
	// We're not bothering about room state, so flag the event as an outlier.
	// event.internalMetadata.outlier = true;
	// const context = EventContext.forOutlier(this._storageControllers);

	// validateEventForRoomVersion(event);
	switch (true) {
		case isRoomCreateEvent(event): {
			await validateRoomCreateEvent(event, authEvents);
			return true;
		}
		case isRoomMemberEvent(event): {
			await validateRoomMemberEvent(event, authEvents);
			return true;
		}
	}

	const caller = [...authMap.values()].find((authEvent) => {
		if (isRoomMemberEvent(authEvent)) {
			return authEvent.state_key === event.sender;
		}
		return false;
	}) as RoomMemberEvent | undefined;

	const callerInRoom = caller?.content.membership === "join";

	const callerPowerLevel = getUserPowerLevel(event.sender, authEvents);

	const inviteLevel = getNamedPowerLevel("invite", authEvents) ?? 0;

	// 5 If the sender’s current membership state is not join, reject.
	if (!callerInRoom) {
		throw new Error("Invalid sender");
	}
	// 6 If type is m.room.third_party_invite:
	if (event.type === "m.room.third_party_invite") {
		// 6.1 Allow if and only if sender’s current power level is greater than or equal to the invite level.
		if (callerPowerLevel >= inviteLevel) {
			return;
		}
		throw new Error("Invalid sender");
	}

	// TODO: 7 If the event type’s required power level is greater than the sender’s power level, reject.

	// TODO: 8 If the event has a state_key that starts with an @ and does not match the sender, reject.
	if (
		"state_key" in event &&
		event.state_key &&
		event.state_key.startsWith("@") &&
		event.state_key !== event.sender
	) {
		throw new Error("Invalid state_key");
	}

	// 9 If type is m.room.power_levels
	if (isRoomPowerLevelsEvent(event)) {
		await validateRoomPowerLevelsEvent(event, authEvents);
	}
	// 10 otherwise, allow.
	return true;
}

export const getNamedPowerLevel = (
	name: PowerLevelNames,
	authEvents: Map<string, EventBase>,
) => {
	const powerLevelEvent = getEventPowerLevel(authEvents);
	if (!powerLevelEvent) {
		return;
	}
	return powerLevelEvent.content[name];
};

const getEventPowerLevel = (authEvents: Map<string, EventBase>) =>
	[...authEvents.values()].find(isRoomPowerLevelsEvent);

export function getUserPowerLevel(
	userId: string,
	authEvents: Map<string, EventBase>,
): number {
	/**
	 * Get a user's power level.
	 *
	 * @param userId - User's ID to look up in power levels.
	 * @param authEvents - State in force at this point in the room (or rather, a subset
	 *                     of it including at least the create event and power levels event).
	 * @returns The user's power level in this room.
	 */

	const powerLevelEvent = getEventPowerLevel(authEvents);

	if (powerLevelEvent) {
		const powerLevelDefault = powerLevelEvent.content?.users_default ?? 0;

		return Number(
			powerLevelEvent.content?.users?.[userId] ?? powerLevelDefault,
		);
	}
	// If there is no power levels event, the creator gets 100 and everyone else gets 0.

	// Some things which call this don't pass the create event: hack around that.

	const createEvent = [...authEvents.values()].find(isRoomCreateEvent);

	if (createEvent) {
		// TODO: const creator = createEvent.roomVersion?.implicitRoomCreator
		// 	? createEvent.sender
		// 	: createEvent.content?.[EventContentFields.ROOM_CREATOR];

		if (createEvent.sender === userId) {
			return 100;
		}
	}

	return 0;
}
