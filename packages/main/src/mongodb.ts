import { MongoClient } from "mongodb";
import type { EventBase } from "./events/eventBase";

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

export const eventsCollection = db.collection<EventStore>("events");
