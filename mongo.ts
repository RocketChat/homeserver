import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
	throw new Error(
		"Please define the MONGODB_URI environment variable inside .env",
	);
}

const client = await MongoClient.connect(MONGODB_URI);

export const db = client.db(MONGODB_URI.split("/").pop());
