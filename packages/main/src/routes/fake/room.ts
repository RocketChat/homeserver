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
import type { EventBase } from "../../events/eventBase";

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
		_id: createEventId,
		event: createEvent,
	});

	// Member
	const memberEvent = await signEvent(
		roomMemberEvent({
			roomId,
			sender,
			depth: 2,
			membership: "join",
			content: {
				displayname: sender,
			},
			state_key: sender,
			auth_events: [createEventId],
			prev_events: [createEventId],
		}),
		config.signingKey[0],
	);

	const memberEventId = generateId(memberEvent);

	events.push({
		_id: memberEventId,
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
		_id: powerLevelsEventId,
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
		_id: joinRulesEventId,
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
				// joinRulesEventId,
			],
			prev_events: [joinRulesEventId],
			depth: 5,
		}),
		config.signingKey[0],
	);

	const historyVisibilityEventId = generateId(historyVisibilityEvent);

	events.push({
		_id: historyVisibilityEventId,
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
				// joinRulesEventId,
				// historyVisibilityEventId,
			],
			prev_events: [historyVisibilityEventId],
			depth: 6,
		}),
		config.signingKey[0],
	);

	const guestAccessEventId = generateId(guestAccessEvent);

	events.push({
		_id: guestAccessEventId,
		event: guestAccessEvent,
	});

	return {
		roomId,
		events,
	};
};

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
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
			const { username, sender } = body;
			let { roomId } = body;

			if (!username.includes(":") || !username.includes("@")) {
				return error(400, "Invalid username");
			}

			const { eventsCollection } = await import("../../mongodb");

			// Create room if no roomId to facilitate tests
			if (sender && !roomId) {
				if (sender.split(":").pop() !== config.name) {
					return error(400, "Invalid sender");
				}

				const { roomId: newRoomId, events } = await createRoom(
					sender,
					username,
				);
				roomId = newRoomId;

				if (events.length === 0) {
					return error(500, "Error creating room");
				}

				await eventsCollection.insertMany(events);
			}

			if (!roomId) {
				return error(400, "Invalid room_id");
			}

			const events = await eventsCollection
				.find({ "event.room_id": roomId }, { sort: { "event.depth": 1 } })
				.toArray();

			if (events.length === 0) {
				return error(400, "No events found");
			}

			const lastEventId = events[events.length - 1]._id;
			const lastEvent = events[events.length - 1].event as any; //TODO: fix typing

			const inviteEvent = await signEvent(
				roomMemberEvent({
					auth_events: lastEvent.auth_events,
					membership: "invite",
					depth: lastEvent.depth + 1,
					// origin: lastEvent.origin,
					content: {
						is_direct: true,
					},
					roomId,
					ts: Date.now(),
					prev_events: [lastEventId],
					sender: events[0].event.sender,
					state_key: username,
					unsigned: {
						age: 4, // TODO: Check what this is
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
					},
				}),
				config.signingKey[0],
			);

			const inviteEventId = generateId(inviteEvent);

			// await eventsCollection.insertOne({
			// 	_id: inviteEventId,
			// 	event: inviteEvent,
			// });

			const payload = {
				event: inviteEvent,
				invite_room_state: inviteEvent.unsigned.invite_room_state,
				room_version: "10",
			};

			console.log("invite payload ->", payload);
			console.log("invite roomId ->", roomId);
			console.log("invite eventId ->", inviteEventId);

			const response = await makeUnsignedRequest({
				method: "PUT",
				domain: username.split(":").pop() as string,
				uri: `/_matrix/federation/v2/invite/${roomId}/${inviteEventId}`,
				options: {
					body: payload,
				},
			});

			console.log(response.status);
			const responseMake = await response.json();
			const responseEventId = generateId(responseMake.event);
			console.log("invite response responseEventId ->", responseEventId);
			console.log("invite response ->", responseMake);

			await eventsCollection.insertOne({
				_id: responseEventId,
				event: responseMake.event,
			});

			return responseMake;
		},
		{
			body: t.Object(
				{
					username: t.String(),
					roomId: t.Optional(t.String()),
					sender: t.Optional(t.String()),
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
	)
	.post(
		"/sendMessage",
		async ({ body, error }) => {
			const { sender, roomId, msg, target } = body;

			const { eventsCollection } = await import("../../mongodb");

			const create = await eventsCollection.findOne({
				"event.room_id": roomId,
				"event.type": "m.room.create",
			});

			const powerLevels = await eventsCollection.findOne({
				"event.room_id": roomId,
				"event.type": "m.room.power_levels",
			});

			const member = await eventsCollection.findOne({
				"event.room_id": roomId,
				"event.type": "m.room.member",
				"event.content.membership": "join",
			});

			const [last] = await eventsCollection
				.find(
					{
						"event.room_id": roomId,
					},
					{ sort: { "event.origin_server_ts": -1 }, limit: 1 },
				)
				.toArray();

			if (!create || !member || !last || !powerLevels) {
				console.log(
					"!create, !member, !last, !powerLevels",
					!create,
					!member,
					!last,
					!powerLevels,
				);
				return error(400, "Invalid room_id");
			}

			// powerLevels.event_id = generateId(powerLevels);

			const event: EventBase = {
				auth_events: [create._id, powerLevels._id, member._id],
				prev_events: [last._id],
				type: "m.room.message",
				depth: last.event.depth + 1,
				content: {
					msgtype: "m.text",
					body: msg,
					"m.mentions": {},
				},
				origin: config.name,
				origin_server_ts: Date.now(),
				room_id: roomId,
				unsigned: {},
				sender,
			};

			const signedEvent = await signEvent(event, config.signingKey[0]);
			const eventId = generateId(signedEvent);

			await eventsCollection.insertOne({
				_id: eventId,
				event: signedEvent,
			});

			const payload = {
				origin: config.name,
				origin_server_ts: Date.now(),
				pdus: [signedEvent],
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
	);
