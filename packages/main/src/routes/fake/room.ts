import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import { config } from "../../config";
import { signJson } from "../../signJson";
import { computeHash, generateId } from "../../authentication";
import { makeUnsignedRequest } from "../../makeRequest";
import { pruneEventDict } from "../../pruneEventDict";
import { roomCreateEvent } from "../../events/m.room.create";
import { signEvent } from "../../signEvent";
import { roomMemberEvent } from "../../events/m.room.member";
import { roomPowerLevelsEvent } from "../../events/m.room.power_levels";
import { roomJoinRulesEvent } from "../../events/m.room.join_rules";
import { roomHistoryVisibilityEvent } from "../../events/m.room.history_visibility";
import { roomGuestAccessEvent } from "../../events/m.room.guest_access";
import Crypto from "node:crypto";

// TODO: Move this to an appropriate file
function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Crypto.randomInt(0, characters.length);
		result += characters[randomIndex];
	}
	return result;
}

// TODO: Move this to an appropriate file
const createRoom = async (sender: string, username: string) => {
	// const roomId = `!${generateId({
	// 	ts: Date.now(), // TEMP
	// })}:${config.name}`;

	const roomId = `!${createMediaId(18)}:${config.name}`;

	// Create
	const createEvent = await signEvent(
		roomCreateEvent({
			roomId,
			sender,
		}),
		config.signingKey[0],
	);

	const createEventId = generateId(createEvent);

	console.log({ roomId, createEventId, createEvent });

	// Member
	const memberEvent = await signEvent(
		roomMemberEvent({
			roomId,
			sender,
			depth: 2,
			auth_events: [createEventId],
			prev_events: [createEventId],
		}),
		config.signingKey[0],
	);

	const memberEventId = generateId(memberEvent);

	console.log({ roomId, memberEventId, memberEvent });

	// PowerLevels
	const powerLevelsEvent = await signEvent(
		roomPowerLevelsEvent({
			roomId,
			sender,
			member: username,
			auth_events: [createEventId, memberEventId],
			prev_events: [memberEventId],
			depth: 3,
		}),
		config.signingKey[0],
	);

	const powerLevelsEventId = generateId(powerLevelsEvent);

	console.log({ roomId, powerLevelsEventId, powerLevelsEvent });

	// Join Rules
	const joinRulesEvent = await signEvent(
		roomJoinRulesEvent({
			roomId,
			sender,
			auth_events: [createEventId, memberEventId, powerLevelsEventId],
			prev_events: [powerLevelsEventId],
			depth: 4,
		}),
		config.signingKey[0],
	);

	const joinRulesEventId = generateId(joinRulesEvent);

	console.log({ roomId, joinRulesEventId, joinRulesEvent });

	// History Visibility
	const historyVisibilityEvent = await signEvent(
		roomHistoryVisibilityEvent({
			roomId,
			sender,
			auth_events: [
				createEventId,
				memberEventId,
				powerLevelsEventId,
				joinRulesEventId,
			],
			prev_events: [joinRulesEventId],
			depth: 5,
		}),
		config.signingKey[0],
	);

	const historyVisibilityEventId = generateId(historyVisibilityEvent);

	console.log({ roomId, historyVisibilityEventId, historyVisibilityEvent });

	// Guest Access
	const guestAccessEvent = await signEvent(
		roomGuestAccessEvent({
			roomId,
			sender,
			auth_events: [
				createEventId,
				memberEventId,
				powerLevelsEventId,
				joinRulesEventId,
				historyVisibilityEventId,
			],
			prev_events: [historyVisibilityEventId],
			depth: 6,
		}),
		config.signingKey[0],
	);

	const guestAccessEventId = generateId(guestAccessEvent);

	console.log({ roomId, guestAccessEventId, guestAccessEvent });

	return {
		roomId,
		guestAccessEventId,
		guestAccessEvent,
	};
};

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
	.post(
		"/sendMessage",
		async ({ body, error }) => {
			const { depth = 13, sender, roomId, msg, target } = body as any;

			const { events } = await import("../../mongodb");

			const create = await events.findOne({
				room_id: roomId,
				type: "m.room.create",
			});

			// const powerLevels = await events.findOne({
			// 	room_id: roomId,
			// 	type: "m.room.power_levels",
			// });

			const member = await events.findOne({
				room_id: roomId,
				type: "m.room.member",
				"content.membership": "join",
			});

			const [last] = await events
				.find(
					{
						room_id: roomId,
					},
					{ sort: { origin_server_ts: -1 }, limit: 1 },
				)
				.toArray();

			if (!create || !member || !last) {
				return error(400, "Invalid room_id");
			}

			create.event_id = generateId(create);
			member.event_id = generateId(member);
			last.event_id = generateId(last);
			// powerLevels.event_id = generateId(powerLevels);

			const event = {
				auth_events: [
					create.event_id,
					// powerLevels.event_id,
					member.event_id,
				],
				prev_events: [last.event_id],
				type: "m.room.message",
				depth,
				content: {
					body: msg,
				},
				origin: config.name,
				origin_server_ts: Date.now(),
				room_id: roomId,
				sender,
			};

			const payload = {
				origin: config.name,
				origin_server_ts: Date.now(),
				pdus: [
					{
						...(await signJson(
							pruneEventDict(computeHash(event)),
							config.signingKey[0],
							config.name,
						)),
						...event,
					},
				],
			};
			console.log("payload ->", payload);

			const response = await makeUnsignedRequest({
				method: "PUT",
				domain: target,
				uri: `/_matrix/federation/v1/send/${Date.now()}`,
				options: {
					body: payload,
				},
			});

			const responseMake = await response.json();
			console.log("response ->", responseMake);

			return responseMake;
		},
		{
			body: t.Object(
				{
					sender: t.String(),
					roomId: t.String(),
					msg: t.String(),
					target: t.String(),
				},
				{
					examples: [
						{
							sender: "@a1:rc1",
							roomId: "!uTqsSSWabZzthsSCNf:hs1",
							msg: "My awoesome message",
							target: "hs1",
						},
					],
				},
			),
			detail: {
				description:
					"Send a message to a room. The sender must be the user ID. The target must be the server name.",
			},
		},
	)
	.post(
		"/createRoom",
		async ({ body, error }) => {
			const { username, sender } = body as any;

			if (sender.split(":").pop() !== config.name) {
				return error(400, "Invalid sender");
			}

			const room = await createRoom(sender, username);

			const lastEvent = room.guestAccessEvent as any; // TODO: Improve typing here

			const payload = {
				event: await signEvent(
					{
						auth_events: lastEvent.auth_events,
						type: "m.room.member",
						content: {
							membership: "invite",
						},
						depth: lastEvent.depth + 1,
						origin: lastEvent.origin,
						origin_server_ts: Date.now(),
						prev_events: [room.guestAccessEventId], // TODO: Improve the return of the events to contain the event_id
						room_id: room.roomId,
						sender,
						state_key: username,
						unsigned: {
							age: 4, // TODO: Check what this is
						},
					},
					config.signingKey[0],
				),
				invite_room_state: [
					{
						content: {},
						sender,
						state_key: "",
						type: "m.room.join_rules",
					},
					{
						content: {},
						sender,
						state_key: "",
						type: "m.room.create",
					},
					{
						content: {},
						sender,
						state_key: sender,
						type: "m.room.member",
					},
				],
				room_version: "10",
			};

			const eventId = generateId(payload.event);

			console.log("payload ->", payload);
			console.log("roomId ->", room.roomId);
			console.log("eventId ->", eventId);

			const response = await makeUnsignedRequest({
				method: "PUT",
				domain: username.split(":").pop(),
				uri: `/_matrix/federation/v2/invite/${room.roomId}/${eventId}`,
				options: {
					body: payload,
				},
			});

			console.log(response.status);
			const responseMake = await response.json();
			console.log("response ->", responseMake);

			return responseMake;
		},
		{
			body: t.Object(
				{
					username: t.String(),
					sender: t.String(),
				},
				{
					examples: [
						{
							username: "@admin:hs1",
							sender: `@a${Math.floor(Math.random() * 100) + 1}:rc1`,
						},
					],
				},
			),
			detail: {
				description:
					"Create a room and invite a user. The sender must be the server name. The username must be the user ID.",
			},
		},
	);
