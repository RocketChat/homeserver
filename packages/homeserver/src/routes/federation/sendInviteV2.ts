import { Elysia, t } from "elysia";

import { InviteEventDTO } from "../../dto";
import { StrippedStateDTO } from "../../dto";
import { ErrorDTO } from "../../dto";
import { makeSignedRequest } from "../../makeRequest";
import { type HashedEvent, generateId } from "../../authentication";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { isConfigContext } from "../../plugins/isConfigContext";
import { MatrixError } from "../../errors";

import type { SignedJson } from "../../signJson";
import type { EventBase } from "@hs/core/src/events/eventBase";
import {
	getPublicKeyFromRemoteServer,
	makeGetPublicKeyFromServerProcedure,
} from "../../procedures/getPublicKeyFromServer";
import { checkSignAndHashes } from "./checkSignAndHashes";

export const sendInviteV2Route = new Elysia().put(
	"/invite/:roomId/:eventId",
	async ({ params, body, ...context }) => {
		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}
		if (!isConfigContext(context)) {
			throw new Error("No config context");
		}
		const {
			config,
			mongo: { eventsCollection, upsertRoom },
		} = context;

		console.log("invite received ->", { params, body });

		await eventsCollection.insertOne({
			_id: generateId(body.event),
			event: body.event,
		});

		setTimeout(async () => {
			const { event } = body;

			const responseMake = await makeSignedRequest({
				method: "GET",
				domain: event.origin,
				uri: `/_matrix/federation/v1/make_join/${params.roomId}/${event.state_key}`,
				signingKey: config.signingKey[0],
				signingName: config.name,
				queryString: "ver=10",
			});

			console.log("make_join response ->", responseMake);

			// const joinBody = {
			//   type: 'm.room.member',
			//   origin: config.name,
			//   origin_server_ts: Date.now(),
			//   room_id: responseMake.event.room_id,
			//   state_key: responseMake.event.state_key,
			//   sender: responseMake.event.sender,
			//   depth: responseMake.event.depth + 1,
			//   content: {
			//     membership: 'join'
			//   }
			// };

			const responseBody = await makeSignedRequest({
				method: "PUT",
				domain: event.origin,
				uri: `/_matrix/federation/v2/send_join/${params.roomId}/${event.state_key}`,
				body: {
					...responseMake.event,
					origin: config.name,
					origin_server_ts: Date.now(),
					depth: responseMake.event.depth + 1,
				},
				signingKey: config.signingKey[0],
				signingName: config.name,
				queryString: "omit_members=false",
			});

			console.log("send_join response ->", { responseBody });

			const { event: pdu, origin } = responseBody;

			const createEvent = responseBody.state.find(
				(event) => event.type === "m.room.create",
			);

			if (!createEvent) {
				throw new MatrixError("400", "Invalid response");
			}

			if (pdu) {
				await eventsCollection.insertOne({
					_id: generateId(responseBody.event),
					event: responseBody.event,
				});
			}

			const auth_chain = new Map(
				responseBody.auth_chain.map((event) => [generateId(event), event]),
			);

			const state = new Map(
				responseBody.state.map((event) => [generateId(event), event]),
			);

			const getPublicKeyFromServer = makeGetPublicKeyFromServerProcedure(
				context.mongo.getValidPublicKeyFromLocal,
				(origin, key) => getPublicKeyFromRemoteServer(origin, config.name, key),

				context.mongo.storePublicKey,
			);

			const validPDUs = new Map<string, EventBase>();

			for await (const [eventId, event] of [
				...auth_chain.entries(),
				...state.entries(),
			]) {
				// check sign and hash of event
				if (
					await checkSignAndHashes(
						event as SignedJson<HashedEvent<EventBase>>,
						event.origin,
						getPublicKeyFromServer,
					).catch((e) => {
						console.log("Error checking signature", e);
						return false;
					})
				) {
					validPDUs.set(eventId, event);
				} else {
					console.log("Invalid event", event);
				}
			}

			const signedAuthChain = [...auth_chain.entries()].filter(([eventId]) =>
				validPDUs.has(eventId),
			);

			const signedState = [...state.entries()].filter(([eventId]) =>
				validPDUs.has(eventId),
			);

			const signedCreateEvent = signedAuthChain.find(
				([, event]) => event.type === "m.room.create",
			);

			if (!signedCreateEvent) {
				console.log("Invalid create event", validPDUs);
				throw new MatrixError(
					"400",
					"Unexpected create event(s) in auth chain",
				);
			}

			await upsertRoom(
				signedCreateEvent[1].room_id,
				signedState.map(([, event]) => event),
			);

			await Promise.all(
				signedState.map(([eventId, event]) => {
					const promise = eventsCollection
						.insertOne({
							_id: eventId,
							event,
						})
						.catch((e) => {
							// TODO events failing because of duplicate key
							// the reason is that we are saving the event on invite event
							console.error("error saving event", e, event);
						});
					return promise;
				}) ?? [],
			);
		}, 1000);

		return { event: body.event };
	},
	{
		params: t.Object(
			{
				roomId: t.String({
					description: "The room ID that the user is being invited to.",
				}),
				eventId: t.String({
					description:
						"The event ID for the invite event, generated by the inviting server.",
				}),
			},
			{
				examples: [
					{
						roomId: "!abc123:matrix.org",
						eventId: "$abc123:example.org",
					},
				],
			},
		),
		body: t.Object(
			{
				room_version: t.String({
					description:
						"The version of the room where the user is being invited to.",
				}),
				event: InviteEventDTO,
				invite_room_state: t.Optional(
					t.Array(StrippedStateDTO, {
						description:
							"An optional list of stripped state events\nto help the receiver of the invite identify the room.",
					}),
				),
			},
			{
				examples: [
					{
						room_version: "2",
						event: {
							room_id: "!somewhere:example.org",
							type: "m.room.member",
							state_key: "@joe:elsewhere.com",
							origin: "example.org",
							origin_server_ts: 1549041175876,
							sender: "@someone:example.org",
							content: {
								membership: "invite",
							},
							signatures: {
								"example.com": {
									"ed25519:key_version": "SomeSignatureHere",
								},
							},
						},
					},
				],
			},
		),
		response: {
			200: t.Object(
				{
					event: InviteEventDTO,
				},
				{
					description:
						'**Note:**\nThis API is nearly identical to the v1 API with the exception of the request\nbody being different, and the response format fixed.\n\nInvites a remote user to a room. Once the event has been  signed by both the inviting\nhomeserver and the invited homeserver, it can be sent to all of the servers in the\nroom by the inviting homeserver.\n\nThis endpoint is preferred over the v1 API as it is more useful for servers. Senders\nwhich receive a 400 or 404 response to this endpoint should retry using the v1\nAPI as the server may be older, if the room version is "1" or "2".\n\nNote that events have a different format depending on the room version - check the\nroom version specification for precise event formats. **The request and response\nbodies here describe the common event fields in more detail and may be missing other\nrequired fields for a PDU.**',
					examples: [
						{
							event: {
								room_id: "!somewhere:example.org",
								type: "m.room.member",
								state_key: "@someone:example.org",
								origin: "example.org",
								origin_server_ts: 1549041175876,
								sender: "@someone:example.org",
								unsigned: {
									invite_room_state: [
										{
											type: "m.room.name",
											sender: "@bob:example.org",
											state_key: "",
											content: {
												name: "Example Room",
											},
										},
										{
											type: "m.room.join_rules",
											sender: "@bob:example.org",
											state_key: "",
											content: {
												join_rule: "invite",
											},
										},
									],
								},
								content: {
									membership: "invite",
								},
								signatures: {
									"example.com": {
										"ed25519:key_version": "SomeSignatureHere",
									},
									"elsewhere.com": {
										"ed25519:k3y_versi0n": "SomeOtherSignatureHere",
									},
								},
							},
						},
					],
				},
			),
			400: t.Composite(
				[
					ErrorDTO,
					t.Object({
						room_version: t.Optional(
							t.String({
								description:
									"The version of the room. Required if the `errcode`\nis `M_INCOMPATIBLE_ROOM_VERSION`.",
							}),
						),
					}),
				],
				{
					description:
						"The request is invalid or the room the server is attempting\nto join has a version that is not listed in the `ver`\nparameters.\n\nThe error should be passed through to clients so that they\nmay give better feedback to users.",
					examples: [
						{
							errcode: "M_INCOMPATIBLE_ROOM_VERSION",
							error:
								"Your homeserver does not support the features required to join this room",
							room_version: "3",
						},
					],
				},
			),
			403: t.Composite([ErrorDTO], {
				description:
					"The invite is not allowed. This could be for a number of reasons, including:\n\n* The sender is not allowed to send invites to the target user/homeserver.\n* The homeserver does not permit anyone to invite its users.\n* The homeserver refuses to participate in the room.",
				examples: [
					{
						errcode: "M_FORBIDDEN",
						error: "User cannot invite the target user.",
					},
				],
			}),
		},
		detail: {
			description:
				'**Note:**\nThis API is nearly identical to the v1 API with the exception of the request\nbody being different, and the response format fixed.\n\nInvites a remote user to a room. Once the event has been  signed by both the inviting\nhomeserver and the invited homeserver, it can be sent to all of the servers in the\nroom by the inviting homeserver.\n\nThis endpoint is preferred over the v1 API as it is more useful for servers. Senders\nwhich receive a 400 or 404 response to this endpoint should retry using the v1\nAPI as the server may be older, if the room version is "1" or "2".\n\nNote that events have a different format depending on the room version - check the\nroom version specification for precise event formats. **The request and response\nbodies here describe the common event fields in more detail and may be missing other\nrequired fields for a PDU.**',
			operationId: "sendInviteV2",
			security: [
				{
					matrixAuth: [],
				},
			],
		},
	},
);
