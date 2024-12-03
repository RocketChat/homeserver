import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import Crypto from "node:crypto";
import { computeHash, generateId } from "../../authentication";
import { config } from "../../config";
import { roomCreateEvent } from "../../events/m.room.create";
import { roomGuestAccessEvent } from "../../events/m.room.guest_access";
import { roomHistoryVisibilityEvent } from "../../events/m.room.history_visibility";
import { roomJoinRulesEvent } from "../../events/m.room.join_rules";
import { roomMemberEvent } from "../../events/m.room.member";
import { roomPowerLevelsEvent } from "../../events/m.room.power_levels";
import { makeUnsignedRequest } from "../../makeRequest";
import { pruneEventDict } from "../../pruneEventDict";
import { signEvent } from "../../signEvent";
import { signJson } from "../../signJson";

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

	const events = [];

	// Create
	const createEvent = await signEvent(
		roomCreateEvent({
			roomId,
			sender,
		}),
		config.signingKey[0],
	);

	const createEventId = generateId(createEvent);

	events.push({
		eventId: createEventId,
		event: createEvent,
	});

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

	events.push({
		eventId: memberEventId,
		event: memberEvent,
	});

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

	events.push({
		eventId: powerLevelsEventId,
		event: powerLevelsEvent,
	});

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

	events.push({
		eventId: joinRulesEventId,
		event: joinRulesEvent,
	});

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

	events.push({
		eventId: historyVisibilityEventId,
		event: historyVisibilityEvent,
	});

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

	events.push({
		eventId: guestAccessEventId,
		roomId,
		event: guestAccessEvent,
	});

	return {
		roomId,
		events,
	};
};

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
	.post(
		"/sendMessage",
		async ({ body, error }) => {
			const { sender, roomId, msg, target } = body;

			const { eventsCollection } = await import("../../mongodb");

			const create = await eventsCollection.findOne({
				room_id: roomId,
				type: "m.room.create",
			});

			// const powerLevels = await eventsCollection.findOne({
			// 	room_id: roomId,
			// 	type: "m.room.power_levels",
			// });

			const member = await eventsCollection.findOne({
				room_id: roomId,
				type: "m.room.member",
				"content.membership": "join",
			});

			const [last] = await eventsCollection
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
				depth: last.depth + 1,
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
			const { username, sender } = body;

			if (sender.split(":").pop() !== config.name) {
				return error(400, "Invalid sender");
			}

			const { roomId, events } = await createRoom(sender, username);

			if (events.length === 0) {
				return error(500, "Error creating room");
			}

			const { eventsCollection } = await import("../../mongodb");

			await eventsCollection.insertMany(events);

			return {
				roomId,
				events,
			};
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
	)
	.post(
		"/inviteUserToRoom",
		async ({ body, error }) => {
			const { roomId, username } = body;

			if (!username.includes(":") || !username.includes("@")) {
				return error(400, "Invalid username");
			}

			const { eventsCollection } = await import("../../mongodb");

			const events = await eventsCollection
				.find({ roomId: roomId }, { sort: { "event.depth": 1 } })
				.toArray();

			if (events.length === 0) {
				return error(400, "Invalid room_id");
			}

			const lastEventId = events[events.length - 1].eventId;
			const lastEvent = events[events.length - 1].event as any; //TODO: fix typing

			const inviteEvent = await signEvent(
				{
					auth_events: lastEvent.auth_events,
					type: "m.room.member",
					content: {
						membership: "invite",
					},
					depth: lastEvent.depth + 1,
					origin: lastEvent.origin,
					origin_server_ts: Date.now(),
					prev_events: [lastEventId],
					room_id: roomId,
					sender: events[0].event.sender,
					state_key: username,
					unsigned: {
						age: 4, // TODO: Check what this is
					},
				},
				config.signingKey[0],
			);

			const inviteEventId = generateId(inviteEvent);

			await eventsCollection.insertOne({
				eventId: inviteEventId,
				roomId,
				event: inviteEvent,
			});

			const payload = {
				event: inviteEvent,
				invite_room_state: [
					{
						content: {},
						sender: events[0].event.sender,
						state_key: "",
						type: "m.room.join_rules",
					},
					{
						content: {},
						sender: events[0].event.sender,
						state_key: "",
						type: "m.room.create",
					},
					{
						content: {},
						sender: events[0].event.sender,
						state_key: events[0].event.sender,
						type: "m.room.member",
					},
				],
				room_version: "10",
			};

			console.log("payload ->", payload);
			console.log("roomId ->", roomId);
			console.log("eventId ->", inviteEventId);

			const response = await makeUnsignedRequest({
				method: "PUT",
				domain: username.split(":").pop(),
				uri: `/_matrix/federation/v2/invite/${roomId}/${inviteEventId}`,
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
					roomId: t.String(),
				},
				{
					examples: [
						{
							username: "@admin:hs1",
							roomId: `!uTqsSSWabZzthsSCNf:${config.name}`,
						},
					],
				},
			),
			detail: {
				description:
					"Invite a user to a room. The username must be the user ID.",
			},
		},
	);
