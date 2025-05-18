import type { EventBase } from "@hs/core/src/events/eventBase";
import { createRoomCreateEvent } from "@hs/core/src/events/m.room.create";
import { createRoomGuestAccessEvent } from "@hs/core/src/events/m.room.guest_access";
import { createRoomHistoryVisibilityEvent } from "@hs/core/src/events/m.room.history_visibility";
import { createRoomJoinRulesEvent } from "@hs/core/src/events/m.room.join_rules";
import { createRoomMemberEvent } from "@hs/core/src/events/m.room.member";
import { createRoomPowerLevelsEvent } from "@hs/core/src/events/m.room.power_levels";
import type { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";

export const createRoom = async (
	users: [sender: string, ...username: string[]],
	makeSignedEvent: ReturnType<typeof createSignedEvent>,
	roomId: string,
): Promise<{
	roomId: string;
	events: {
		event: EventBase;
		_id: string;
	}[];
}> => {
	// Create

	const [sender, ...members] = users;

	const createRoomSigned = createRoomCreateEvent(makeSignedEvent);

	const createMemberRoomSigned = createRoomMemberEvent(makeSignedEvent);

	const createPowerLevelsRoomSigned =
		createRoomPowerLevelsEvent(makeSignedEvent);

	const createJoinRulesRoomSigned = createRoomJoinRulesEvent(makeSignedEvent);

	const createHistoryVisibilityRoomSigned =
		createRoomHistoryVisibilityEvent(makeSignedEvent);

	const createGuestAccessRoomSigned =
		createRoomGuestAccessEvent(makeSignedEvent);

	const createEvent = await createRoomSigned({
		roomId,
		sender,
	});

	// Member

	const memberEvent = await createMemberRoomSigned({
		roomId,
		sender,
		depth: 2,
		membership: "join",
		content: {
			displayname: sender,
		},
		state_key: sender,
		auth_events: {
			create: createEvent._id,
		},
		prev_events: [createEvent._id],
	});

	// PowerLevels

	const powerLevelsEvent = await createPowerLevelsRoomSigned({
		roomId,
		members: [sender, ...members],
		auth_events: [createEvent._id, memberEvent._id],
		prev_events: [memberEvent._id],
		depth: 3,
	});

	// Join Rules

	const joinRulesEvent = await createJoinRulesRoomSigned({
		roomId,
		sender,
		auth_events: [createEvent._id, memberEvent._id, powerLevelsEvent._id],
		prev_events: [powerLevelsEvent._id],
		depth: 4,
	});

	// History Visibility

	const historyVisibilityEvent = await createHistoryVisibilityRoomSigned({
		roomId,
		sender,
		auth_events: [
			createEvent._id,
			memberEvent._id,
			powerLevelsEvent._id,
			// joinRulesEvent._id,
		],
		prev_events: [joinRulesEvent._id],
		depth: 5,
	});

	// Guest Access
	const guestAccessEvent = await createGuestAccessRoomSigned({
		roomId,
		sender,
		auth_events: [
			createEvent._id,
			memberEvent._id,
			powerLevelsEvent._id,
			// joinRulesEvent._id,
			// historyVisibilityEvent._id,
		],
		prev_events: [historyVisibilityEvent._id],
		depth: 6,
	});

	const events = [
		createEvent,
		memberEvent,
		powerLevelsEvent,
		joinRulesEvent,
		historyVisibilityEvent,
		guestAccessEvent,
	];

	return {
		roomId,
		events: events as any,
	};
};
