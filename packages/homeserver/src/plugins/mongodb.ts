import Elysia from "elysia";
import type { InferContext } from "elysia";
import { type Db, MongoClient } from "mongodb";

import type { EventBase } from "@hs/core/src/events/eventBase";

export interface Server {
	_id: string;
	name: string;
	url: string;
	keys: {
		[key: `${string}:${string}`]: {
			key: string;
			validUntil: number;
		};
	};

	// signatures: {
	// 	from: string;
	// 	signature: string;
	// 	key: string;
	// }[];
}

export const routerWithMongodb = (db: Db) =>
	new Elysia().decorate(
		"mongo",
		(() => {
			const eventsCollection = db.collection<EventStore>("events");
			const serversCollection = db.collection<Server>("servers");

			const getLastEvent = async (roomId: string) => {
				return eventsCollection.findOne(
					{ "event.room_id": roomId },
					{ sort: { "event.depth": -1 } },
				);
			};

			const getDeepEarliestAndLatestEvents = async (
				roomId: string,
				earliest_events: string[],
				latest_events: string[],
			) => {
				const depths = await eventsCollection
					.find(
						{
							_id: { $in: [...earliest_events, ...latest_events] },
							"event.room_id": roomId,
						},
						{ projection: { "event.depth": 1 } },
					)
					.toArray()
					.then((events) => events.map((event) => event.event.depth));

				if (depths.length === 0) {
					return [];
				}

				const minDepth = Math.min(...depths);
				const maxDepth = Math.max(...depths);

				return [minDepth, maxDepth];
			};

			const getMissingEventsByDeep = async (
				roomId: string,
				minDepth: number,
				maxDepth: number,
				limit: number,
			) => {
				const events = await eventsCollection
					.find(
						{
							"event.room_id": roomId,
							"event.depth": { $gte: minDepth, $lte: maxDepth },
						},
						{ limit: limit, sort: { "event.depth": 1 } },
					)
					.map((event) => event.event)
					.toArray();

				return events;
			};

			const getAuthEvents = async (roomId: string) => {
				return eventsCollection
					.find(
						{
							"event.room_id": roomId,
							$or: [
								{
									"event.type": {
										$in: [
											"m.room.create",
											"m.room.power_levels",
											"m.room.join_rules",
										],
									},
								},
								{
									// Lots of room members, when including the join ones it fails the auth check
									"event.type": "m.room.member",
									"event.content.membership": "invite",
								},
							],
						},
						{
							projection: {
								_id: 1,
							},
						},
					)
					.toArray();
			};

			const getValidPublicKeyFromLocal = async (
				origin: string,
				key: string,
			): Promise<string | undefined> => {
				const server = await serversCollection.findOne({
					name: origin,
				});
				if (!server) {
					return;
				}
				const [, publicKey] =
					Object.entries(server.keys).find(
						([protocolAndVersion, value]) =>
							protocolAndVersion === key && value.validUntil > Date.now(),
					) ?? [];
				return publicKey?.key;
			};

			const storePublicKey = async (
				origin: string,
				key: string,
				value: string,
				validUntil: number,
			) => {
				await serversCollection.findOneAndUpdate(
					{ name: origin },
					{
						$set: {
							keys: {
								[key]: {
									key: value,
									validUntil,
								},
							},
						},
					},
					{ upsert: true },
				);
			};

			return {
				serversCollection,
				getValidPublicKeyFromLocal,
				storePublicKey,

				eventsCollection,
				getDeepEarliestAndLatestEvents,
				getMissingEventsByDeep,
				getLastEvent,
				getAuthEvents,
			};
		})(),
	);

export type Context = InferContext<ReturnType<typeof routerWithMongodb>>;

export type EventStore = {
	_id: string;
	event: EventBase;
	staged?: true;
};
