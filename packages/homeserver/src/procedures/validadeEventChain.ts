import type { EventBase } from "@hs/core/src/events/eventBase";
import { generateId } from "../authentication";
import type { EventStore } from "../plugins/mongodb";
import {
	type RoomCreateEvent,
	isRoomCreateEvent,
} from "@hs/core/src/events/m.room.create";
import {
	type RoomMemberEvent,
	isRoomMemberEvent,
} from "@hs/core/src/events/m.room.member";
import {
	type RoomJoinRulesEvent,
	isRoomJoinRulesEvent,
	type JoinRule,
} from "@hs/core/src/events/m.room.join_rules";
import {
	type PowerLevelNames,
	isRoomPowerLevelsEvent,
} from "@hs/core/src/events/m.room.power_levels";
import {
	type RoomThirdPartyInviteEvent,
	isRoomThirdPartyInviteEvent,
} from "@hs/core/src/events/m.room.third_party_invite";
import { verifyJsonSignature, verifySignaturesFromRemote } from "../signJson";
import { t } from "elysia";

const difference = (a: string[], b: string[]) =>
	a.filter((x) => !b.includes(x));
const getMissingEvents = (a: string[]) => [];

export const validateEventChain = async (
	events: EventBase[],
	roomId: string,
) => {
	const eventMap = new Map(events.map((event) => [generateId(event), event]));
	// const eventKeys = Array.from(eventMap.keys());

	const seenRemoteEvents = new Set<EventStore>(); // get from database

	for (const seen of seenRemoteEvents) {
		eventMap.delete(seen._id);
	}

	const authGraph = Object.fromEntries(
		[...eventMap.entries()].map(([id, event]) => {
			return [id, event.auth_events.map((eventId) => eventMap.get(eventId))];
		}),
	);

	const sortedAuthEvents = [...eventMap.values()];

	const authEventIds = sortedAuthEvents
		.flatMap((event) => event.auth_events.map((eventId) => eventId))
		.filter(Boolean);

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

	for await (const event of sortedAuthEvents) {
		console.log("event ->", event);
		console.log("event.auth_events ->", event.auth_events);
		console.log("authMap ->", authMap);
	}
};

async function prep(event: EventBase, authMap: Map<string, EventBase>) {
	const auth: EventBase[] = [];
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
		auth.push(ae);
	}
	// We're not bothering about room state, so flag the event as an outlier.
	// event.internalMetadata.outlier = true;
	// const context = EventContext.forOutlier(this._storageControllers);

	// validateEventForRoomVersion(event);
	switch (true) {
		case isRoomCreateEvent(event): {
			await validateRoomCreateEvent(event, authMap);
			break;
		}
		case isRoomMemberEvent(event): {
			await validateRoomMemberEvent(event, authMap);
			break;
		}
	}
	// } catch (error) {}
	// 	if (error instanceof AuthError) {
	// 		logger.warning(
	// 			`Rejecting ${JSON.stringify(event)} because ${error.message}`,
	// 		);
	// 		context.rejected = RejectedReason.AUTH_ERROR;
	// 	} else if (error instanceof EventSizeError) {
	// 		if (error.unpersistable) {
	// 			// This event is completely unpersistable.
	// 			throw error;
	// 		}
	// 		// Otherwise, we are somewhat lenient and just persist the event
	// 		// as rejected, for moderate compatibility with older versions.
	// 		logger.warning(
	// 			`While validating received event ${event.event_id}: ${error.message}`,
	// 		);
	// 		context.rejected = RejectedReason.OVERSIZED_EVENT;
	// 	} else {
	// 		throw error; // Re-throw unexpected errors
	// 	}
	// eventsAndContextsToPersist.push([event, context]);
}

async function validateRoomMemberEvent(
	event: RoomMemberEvent,
	authMap: Map<string, EventBase>,
) {
	// todo compare creating and originating event
	// 4 If type is m.room.member:
	//  4.1 If no state_key key or membership key in content, reject.
	if (!event.state_key || !event.content.membership) {
		throw new Error("Missing state_key or membership");
	}

	//  4.2 If content has a join_authorised_via_users_server key:
	if (event.content.join_authorised_via_users_server) {
		// TODO:  4.2.1 If the event is not validly signed by the user ID denoted by the key, reject.
		throw new Error("Invalid signature");
	}

	const joinRule: JoinRule =
		[...authMap.values()].find<RoomJoinRulesEvent>(isRoomJoinRulesEvent)
			?.content.join_rule ?? "invite";

	const caller = [...authMap.values()].find((authEvent) => {
		if (isRoomMemberEvent(authEvent)) {
			return authEvent.state_key === event.sender;
		}
		return false;
	}) as RoomMemberEvent | undefined;

	const callerInRoom = caller?.content.membership === "join";
	const callerInvited = caller?.content.membership === "invite";
	const callerKnocked = caller?.content.membership === "knock";
	const callerPowerLevel = getUserPowerLevel(event.sender, authMap);
	const callerBanned = caller?.content.membership === "ban";

	const target = [...authMap.values()].find((authEvent) => {
		if (isRoomMemberEvent(authEvent)) {
			return authEvent.state_key === event.state_key;
		}
		return false;
	}) as RoomMemberEvent | undefined;

	const isTargetBanned = target?.content.membership === "ban";
	const isTargetInRoom = target?.content.membership === "join";

	const targetPowerLevel = getUserPowerLevel(event.state_key, authMap);

	//  4.3 If membership is join:
	if (event.content.membership === "join") {
		//   4.3.1 If the only previous event is an m.room.create and the state_key is the creator, allow.
		if (event.prev_events.length === 1) {
			const [prevEventId] = event.prev_events;
			const createEvent = authMap.get(prevEventId);
			if (createEvent?.sender === event.state_key) {
				return;
			}
		}
		//   4.3.2 If the sender does not match state_key, reject.
		if (event.sender !== event.state_key) {
			throw new Error("Invalid sender");
		}
		//  TODO: 4.3.3 If the sender is banned, reject.
		if (event.sender === "@banned:hs1") {
			throw new Error("Banned");
		}

		//  4.3.4 If the join_rule is invite then allow if membership state is invite or join.
		if (joinRule === "invite") {
			const caller = [...authMap.values()].find((authEvent) => {
				if (isRoomMemberEvent(authEvent)) {
					return authEvent.sender === event.sender;
				}
				return false;
			}) as RoomMemberEvent | undefined;
			const callerInRoom = caller?.content.membership === "join";
			const callerInvited = caller?.content.membership === "invite";
			if (callerInRoom || callerInvited) {
				return;
			}
			throw new Error("You are not invited to this room.");
		}
		//   4.3.5 If the join_rule is restricted:
		if (joinRule === "restricted" || joinRule === "knock_restricted") {
			//   4.3.5.1 If membership state is join or invite, allow.

			if (callerInRoom || callerInvited) {
				return;
			}
			//   4.3.5.2 If the join_authorised_via_users_server key in content is not a user with sufficient permission to invite other users, reject.
			if (!event.content.join_authorised_via_users_server) {
				throw new Error("Insufficient permission");
			}
			const authorisingUser = [...authMap.values()].find((authEvent) => {
				if (isRoomMemberEvent(authEvent)) {
					return (
						authEvent.state_key ===
						event.content.join_authorised_via_users_server
					);
				}
				return false;
			}) as RoomMemberEvent | undefined;

			if (authorisingUser?.content.membership !== "join") {
				throw new Error("You are not invited to this room.");
			}

			const authorisingUserLevel = getUserPowerLevel(
				authorisingUser.state_key,
				authMap,
			);

			const joinLevel = getNamedPowerLevel("invite", authMap) ?? 0;

			if (authorisingUserLevel < joinLevel) {
				throw new Error("Insufficient permission");
			}

			//  4.3.5.3 Otherwise, allow.
			return;
		}
		//   4.3.6 If the join_rule is public, allow.
		if (joinRule === "public") {
			return;
		}
		//  4.3.7 Otherwise, reject.
		throw new Error("Invalid join_rule");
	}

	// 4.4 If membership is invite:
	if (event.content.membership === "invite") {
		// 4.4.1 If content has third_party_invite key:
		if (event.content.third_party_invite) {
			const thirdPartyInvite = event.content.third_party_invite;
			// TODO: 4.4.1.1 If target user is banned, reject.
			if (event.sender === "@banned:hs1") {
				throw new Error("Banned");
			}
			// 4.4.1.2 If content.third_party_invite does not have a signed key, reject.
			if (!("signed" in thirdPartyInvite)) {
				throw new Error("Missing signed key");
			}

			const { signed } = thirdPartyInvite;
			// 4.4.1.3 If signed does not have mxid and token keys, reject.
			if (
				!["mxid", "token", "signatures"].every(
					(key) => key in thirdPartyInvite.signed,
				)
			) {
				throw new Error("Missing mxid, token, or signatures");
			}
			// 4.4.1.4 If mxid does not match state_key, reject.

			const { mxid } = thirdPartyInvite.signed;
			if (event.state_key !== mxid) {
				throw new Error("Invalid mxid");
			}

			// 4.4.1.5 If there is no m.room.third_party_invite event in the current room state with state_key matching token, reject.
			const { token } = thirdPartyInvite.signed;

			const inviteEvent = [...authMap.values()].find((authEvent) => {
				if (isRoomThirdPartyInviteEvent(authEvent)) {
					// TODO: check if `state_key` is correct
					return authEvent.state_key === token;
				}
				return false;
			}) as RoomThirdPartyInviteEvent | undefined;

			if (!inviteEvent) {
				throw new Error("Invite event not found");
			}

			// TODO: 4.4.1.6 If sender does not match sender of the m.room.third_party_invite, reject.

			if (event.sender !== inviteEvent.sender) {
				throw new Error("Invalid sender");
			}
			// 4.4.1.7 If any signature in signed matches any public key in the m.room.third_party_invite event, allow. The public keys are in content of m.room.third_party_invite as:
			// 4.4.1.7.1 A single public key in the public_key field.
			// 4.4.1.7.2 A list of public keys in the public_keys field.

			const getPublicKeys = (inviteEvent: RoomThirdPartyInviteEvent) => {
				if ("public_key" in inviteEvent.content) {
					const publicKey = {
						public_key: inviteEvent.content.public_key,
						...("key_validity_url" in inviteEvent.content && {
							key_validity_url: inviteEvent.content.key_validity_url,
						}),
					};
					return [publicKey, ...inviteEvent.content.public_keys];
				}

				return inviteEvent.content.public_keys;
			};

			for await (const publicKeyObject of getPublicKeys(inviteEvent)) {
				const publicKey = publicKeyObject.public_key;
				for (const server of Object.keys(signed.signatures)) {
					// verify_signed_json incorrectly states it wants a dict, it
					// just needs a mapping.
					try {
						await verifySignaturesFromRemote(
							signed,
							server,
							async () => new Uint8Array(),
						);
						return true;
					} catch (e) {
						console.log("Error verifying signature", e);
					}
				}
			}

			// 4.4.8 Otherwise, reject.
			throw new Error("Invalid join_rule");
		}
	}

	// 4.5 If membership is leave:
	if (event.content.membership === "leave") {
		// 4.5.1 If the sender matches state_key, allow if and only if that user’s current membership state is invite, join, or knock.
		if (event.state_key === event.sender && (callerInvited || callerKnocked)) {
			return;
		}
		// 4.5.2 If the sender’s current membership state is not join, reject.
		if (!callerInRoom) {
			throw new Error("Invalid sender");
		}
		// 4.5.3 If the target user’s current membership state is ban, and the sender’s power level is less than the ban level, reject.

		if (isTargetBanned && callerPowerLevel < targetPowerLevel) {
			throw new Error("Invalid sender");
		}

		const kickLevel = getNamedPowerLevel("kick", authMap) ?? 50;
		// 4.5.4 If the sender’s power level is greater than or equal to the kick level, and the target user’s power level is less than the sender’s power level, allow.
		if (callerPowerLevel >= kickLevel && targetPowerLevel < callerPowerLevel) {
			return;
		}
		// 4.5.5 Otherwise, reject.
		throw new Error("Invalid join_rule");
	}

	// 4.6 If membership is ban:
	if (event.content.membership === "ban") {
		// 4.6.1 If the sender’s current membership state is not join, reject.
		if (callerInRoom) {
			throw new Error("Invalid sender");
		}
		const banLevel = getNamedPowerLevel("ban", authMap) ?? 50;
		// 4.6.2 If the sender’s power level is greater than or equal to the ban level, and the target user’s power level is less than the sender’s power level, allow.
		if (callerPowerLevel >= banLevel && targetPowerLevel < callerPowerLevel) {
			return;
		}
		// 46.3 Otherwise, reject.
		throw new Error("Invalid join_rule");
	}

	// 4.7 If membership is knock:
	if (event.content.membership === "knock") {
		// 4.7.1 If the join_rule is anything other than knock, reject.
		if (joinRule !== "knock") {
			throw new Error("Invalid join_rule");
		}
		// 4.7.2 If sender does not match state_key, reject.
		if (event.sender !== event.state_key) {
			throw new Error("Invalid sender");
		}

		if (isTargetInRoom) {
			throw new Error("Invalid sender");
		}

		if (isTargetBanned) {
			throw new Error("Invalid sender");
		}

		// 4.7.3 If the sender’s current membership is not ban, invite, or join, allow.
		if (!(callerBanned && callerInvited && callerInRoom)) {
			return;
		}
		// 4.7.4 Otherwise, reject.
		throw new Error("Invalid join_rule");
	}

	throw new Error("Invalid membership");
}
async function validateRoomCreateEvent(
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

const getNamedPowerLevel = (
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

function getUserPowerLevel(
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
