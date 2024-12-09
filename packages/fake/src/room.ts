import { Elysia, t } from "elysia";

import "@hs/endpoints/src/query";
import "@hs/endpoints/src/server";
import Crypto from "node:crypto";

import { generateId } from "@hs/homeserver/src/authentication";
import { isConfigContext } from "@hs/homeserver/src/plugins/isConfigContext";
import { isMongodbContext } from "@hs/homeserver/src/plugins/isMongodbContext";
import { createRoom } from "@hs/homeserver/src/procedures/createRoom";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import { signEvent } from "@hs/homeserver/src/signEvent";
import { roomMemberEvent } from "@hs/core/src/events/m.room.member";
import { makeUnsignedRequest } from "@hs/homeserver/src/makeRequest";
import type { EventBase } from "@hs/core/src/events/eventBase";

function createMediaId(length: number) {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < length; i++) {
		const randomIndex = Crypto.randomInt(0, characters.length);
		result += characters[randomIndex];
	}
	return result;
}

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
	.post(
		"/createRoom",
		async ({ body, error, ...context }) => {
			if (!isConfigContext(context)) {
				throw new Error("No config context");
			}
			if (!isMongodbContext(context)) {
				throw new Error("No mongodb context");
			}
			const {
				config,
				mongo: { eventsCollection },
			} = context;

			const { username, sender } = body;

			if (sender.split(":").pop() !== config.name) {
				return error(400, "Invalid sender");
			}

			const { roomId, events } = await createRoom(
				sender,
				username,
				createSignedEvent(config.signingKey[0], config.name),
				`!${createMediaId(18)}:${config.name}`,
			);

			if (events.length === 0) {
				return error(500, "Error creating room");
			}

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
		async ({ body, error, ...context }) => {
			if (!isConfigContext(context)) {
				throw new Error("No config context");
			}
			if (!isMongodbContext(context)) {
				throw new Error("No mongodb context");
			}
			const {
				config,
				mongo: { eventsCollection },
			} = context;

			const { username, sender } = body;
			let { roomId } = body;

			if (!username.includes(":") || !username.includes("@")) {
				return error(400, "Invalid username");
			}

			// Create room if no roomId to facilitate tests
			if (sender && !roomId) {
				if (sender.split(":").pop() !== config.name) {
					return error(400, "Invalid sender");
				}

				const { roomId: newRoomId, events } = await createRoom(
					sender,
					username,
					createSignedEvent(config.signingKey[0], config.name),
					`!${createMediaId(18)}:${config.name}`,
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
								// @ts-ignore
								content: {},
								sender: events[0].event.sender,
								state_key: "",
								type: "m.room.join_rules",
							},
							{
								// @ts-ignore
								content: {},
								sender: events[0].event.sender,
								state_key: "",
								type: "m.room.create",
							},
							{
								// @ts-ignore
								content: {},
								sender: events[0].event.sender,
								state_key: events[0].event.sender,
								type: "m.room.member",
							},
						],
					},
				}),
				config.signingKey[0],
				config.name,
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

			const responseMake = await makeUnsignedRequest({
				method: "PUT",
				domain: username.split(":").pop() as string,
				uri: `/_matrix/federation/v2/invite/${roomId}/${inviteEventId}`,
				body: payload,
				options: {},
				signingKey: config.signingKey[0],
				signingName: config.name,
			});

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
							roomId: "!uTqsSSWabZzthsSCNf:homeserver",
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
		async ({ body, error, ...context }) => {
			if (!isConfigContext(context)) {
				throw new Error("No config context");
			}
			if (!isMongodbContext(context)) {
				throw new Error("No mongodb context");
			}
			const {
				config,
				mongo: { eventsCollection },
			} = context;

			const { sender, roomId, msg, target } = body;

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

			const signedEvent = await signEvent(
				event,
				config.signingKey[0],
				config.name,
			);
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

			const responseMake = await makeUnsignedRequest({
				method: "PUT",
				domain: target,
				uri: `/_matrix/federation/v1/send/${Date.now()}`,
				body: payload,
				signingKey: config.signingKey[0],
				signingName: config.name,
			} as any);

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
