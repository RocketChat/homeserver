import Elysia from "elysia";
import type { InferContext } from "elysia";
import { type Db, MongoClient } from "mongodb";

import { NotFoundError } from "elysia";
import type { EventBase } from "../events/eventBase";

export const routerWithMongodb = (db: Db) =>
	new Elysia().decorate(
		"mongo",
		(() => {
			const eventsCollection = db.collection<EventStore>("events");

			const getLastEvent = async (roomId: string) => {
				return eventsCollection.findOne(
					{ "event.room_id": roomId },
					{ sort: { "event.depth": -1 } },
				);
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

			return {
				eventsCollection,
				getLastEvent,
				getAuthEvents,
			};
		})(),
	);

export type Context = InferContext<ReturnType<typeof routerWithMongodb>>;

export type EventStore = {
	_id: string;
	event: EventBase;
};
