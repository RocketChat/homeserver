import Elysia from "elysia";
import type { InferContext } from "elysia";
import { type Db, MongoClient, WithId } from "mongodb";

import type { EventBase } from "@hs/core/src/events/eventBase";
import { generateId } from "../authentication";
import { type ServerKey } from "@hs/core/src/server";

export type Key = WithId<ServerKey>;

interface Room {
	_id: string;
	state: EventBase[];
}

export const routerWithMongodb = (db: Db) =>
	new Elysia().decorate(
		"mongo",
		(() => {
			const eventsCollection = db.collection<EventStore>("events");
			const keysCollection = db.collection<Key>("keys");
			const roomsCollection = db.collection<Room>("rooms");

			const getLastEvent = async (roomId: string) => {
				return eventsCollection.findOne(
					{ "event.room_id": roomId },
					{ sort: { "event.depth": -1 } },
				);
			};

			const upsertRoom = async (roomId: string, state: EventBase[]) => {
				await roomsCollection.findOneAndUpdate(
					{ _id: roomId },
					{
						$set: {
							_id: roomId,
							state,
						},
					},
					{ upsert: true },
				);
			};

			const getEventsByIds = async (roomId: string, eventIds: string[]) => {
				return eventsCollection
					.find({ "event.room_id": roomId, "event._id": { $in: eventIds } })
					.toArray();
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

			const getValidServerKeysFromLocal = async (origin: string) => {
				return keysCollection.findOne({
					name: origin,
					valid_until_ts: { $gte: Date.now() },
				});
			};

			const storeServerKeys = async (
				origin: string,
				serverKeys: Omit<Key, "_id" | "name">,
			) => {
				await keysCollection.findOneAndUpdate(
					{ name: origin, valid_until_ts: { $gte: Date.now() } },
					{
						$set: serverKeys,
					},
					{ upsert: true },
				);
			};

			const createStagingEvent = async (event: EventBase) => {
				const id = generateId(event);
				await eventsCollection.insertOne({
					_id: id,
					event,
					staged: true,
				});

				return id;
			};

			const createEvent = async (event: EventBase) => {
				const id = generateId(event);
				await eventsCollection.insertOne({
					_id: id,
					event,
				});

				return id;
			};

			const removeEventFromStaged = async (roomId: string, id: string) => {
				await eventsCollection.updateOne(
					{ _id: id, "event.room_id": roomId },
					{ $unset: { staged: 1 } },
				);
			};

			const getOldestStagedEvent = async (roomId: string) => {
				return eventsCollection.findOne(
					{ staged: true, "event.room_id": roomId },
					{ sort: { "event.origin_server_ts": 1 } },
				);
			};

			return {
				serversCollection: keysCollection,
				getValidServerKeysFromLocal,
				storeServerKeys,

				eventsCollection,
				getDeepEarliestAndLatestEvents,
				getMissingEventsByDeep,
				getLastEvent,
				getAuthEvents,

				removeEventFromStaged,
				getEventsByIds,
				getOldestStagedEvent,
				createStagingEvent,
				createEvent,
				upsertRoom,
			};
		})(),
	);

export type Context = InferContext<ReturnType<typeof routerWithMongodb>>;

export type EventStore = {
	_id: string;
	event: EventBase;
	staged?: true;
	outlier?: true;
};
