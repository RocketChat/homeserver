import { MongoClient } from "mongodb";
import type { EventBase } from "./events/eventBase";
import { NotFoundError } from "elysia";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
	throw new Error(
		"Please define the MONGODB_URI environment variable inside .env",
	);
}
const client: MongoClient = await MongoClient.connect(MONGODB_URI);

const db = client.db(MONGODB_URI.split("/").pop());

export type EventStore = {
	_id: string;
	event: EventBase;
};

const eventsCollection = db.collection<EventStore>("events");

export const getLastEvent = async (roomId: string) => {
	const events = await eventsCollection
		.find({ "event.room_id": roomId }, { sort: { "event.depth": -1 } })
		.toArray();

	if (events.length === 0) {
		throw new NotFoundError(`No events found for room ${roomId}`);
	}

	return events[0];
};

export const getAuthEvents = async (roomId: string) => {
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
