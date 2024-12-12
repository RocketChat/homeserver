import { Elysia } from "elysia";
import { isMongodbContext } from "../../plugins/isMongodbContext";
import { generateId } from "../../authentication";

export const sendTransactionRoute = new Elysia().put(
	"/send/:txnId",
	async ({ params, body, ...context }) => {
		console.log("receive send ->", params);
		console.log("body ->", body);

		if (!isMongodbContext(context)) {
			throw new Error("No mongodb context");
		}

		const {
			mongo: { eventsCollection },
		} = context;

		const { pdus } = body as any;

		if (pdus) {
			await eventsCollection.insertMany(
				pdus.map((event: any) => ({
					_id: generateId(event),
					event,
				})),
			);
		}

		return {
			[params.txnId]: {},
		};
	},
);
