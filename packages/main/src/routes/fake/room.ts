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

export const fakeEndpoints = new Elysia({ prefix: "/fake" })
	.post("/sendMessage", async ({ body, error }) => {
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
	})
	.post("/createRoom", async ({ body, error }) => {
		const { username, sender } = body as any;

		if (sender.split(":").pop() !== config.name) {
			return error(400, "Invalid sender");
		}

		const roomId = `!${generateId({
			ts: Date.now(), // TEMP
		})}:${config.name}`;

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

		// Member
		// Message
		// Member

		// const payload = {
		// 	origin: config.name,
		// 	origin_server_ts: Date.now(),
		// 	pdus: [
		// 		{
		// 			...(await signJson(
		// 				pruneEventDict(computeHash(event)),
		// 				config.signingKey[0],
		// 				config.name,
		// 			)),
		// 			...event,
		// 		},
		// 	],
		// };
		// console.log("payload ->", payload);

		// const response = await makeUnsignedRequest({
		// 	method: "PUT",
		// 	domain: username.split(":").pop(),
		// 	uri: `/_matrix/federation/v1/send/${Date.now()}`,
		// 	options: {
		// 		body: payload,
		// 	},
		// });

		// console.log(response.status);
		// const responseMake = await response.json();
		// console.log("response ->", responseMake);

		// return responseMake;
	});
