import type { RoomMemberEvent } from '../events/isRoomMemberEvent';
import {
	type RoomCreateEvent,
	createRoomCreateEvent,
} from '../events/m.room.create';
import {
	type RoomGuestAccessEvent,
	createRoomGuestAccessEvent,
} from '../events/m.room.guest_access';
import {
	type RoomHistoryVisibilityEvent,
	createRoomHistoryVisibilityEvent,
} from '../events/m.room.history_visibility';
import {
	type RoomJoinRulesEvent,
	createRoomJoinRulesEvent,
} from '../events/m.room.join_rules';
import { createRoomMemberEvent } from '../events/m.room.member';
import {
	type RoomPowerLevelsEvent,
	createRoomPowerLevelsEvent,
} from '../events/m.room.power_levels';
import type { createSignedEvent } from '../events/utils/createSignedEvent';
import type { SignedEvent } from '../types';

export type IdAndEvent<T> = {
	event: T;
	_id: string;
};

export const createRoom = async (
	users: [sender: string, ...username: string[]],
	makeSignedEvent: ReturnType<typeof createSignedEvent>,
	roomId: string,
): Promise<{
	roomId: string;
	events: [
		IdAndEvent<SignedEvent<RoomCreateEvent>>,
		IdAndEvent<SignedEvent<RoomMemberEvent>>,
		IdAndEvent<SignedEvent<RoomPowerLevelsEvent>>,
		IdAndEvent<SignedEvent<RoomJoinRulesEvent>>,
		IdAndEvent<SignedEvent<RoomHistoryVisibilityEvent>>,
		IdAndEvent<SignedEvent<RoomGuestAccessEvent>>,
	];
}> => {
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

	const memberEvent = await createMemberRoomSigned({
		roomId,
		sender,
		depth: 2,
		membership: 'join',
		content: {
			displayname: sender,
		},
		state_key: sender,
		auth_events: {
			'm.room.create': createEvent._id,
		},
		prev_events: [createEvent._id],
	});

	const powerLevelsEvent = await createPowerLevelsRoomSigned({
		roomId,
		members: [sender, ...members],
		auth_events: [createEvent._id, memberEvent._id],
		prev_events: [memberEvent._id],
		depth: 3,
	});

	const joinRulesEvent = await createJoinRulesRoomSigned({
		roomId,
		sender,
		auth_events: [createEvent._id, memberEvent._id, powerLevelsEvent._id],
		prev_events: [powerLevelsEvent._id],
		depth: 4,
	});

	const historyVisibilityEvent = await createHistoryVisibilityRoomSigned({
		roomId,
		sender,
		auth_events: [createEvent._id, memberEvent._id, powerLevelsEvent._id],
		prev_events: [joinRulesEvent._id],
		depth: 5,
	});

	const guestAccessEvent = await createGuestAccessRoomSigned({
		roomId,
		sender,
		auth_events: [createEvent._id, memberEvent._id, powerLevelsEvent._id],
		prev_events: [historyVisibilityEvent._id],
		depth: 6,
	});

	return {
		roomId,
		events: [
			createEvent,
			memberEvent,
			powerLevelsEvent,
			joinRulesEvent,
			historyVisibilityEvent,
			guestAccessEvent,
		],
	};
};
