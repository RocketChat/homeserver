import { describe, expect, it } from "bun:test";
import { app } from "../../app";

describe("queryProfile", () => {
	it.todo("Non-numeric ports in server names are rejected", async () => {
		const invalidUserID = "@user1:localhost:http";

		const resp = await app.handle(
			new Request(
				`http://localhost/_matrix/federation/v1/query/profile?user_id=${invalidUserID}&field=displayname`,
			),
		);

		expect(resp.status).toBe(400);
	});

	it.todo("Inbound federation can query profile data", async () => {
		const alice = {
			userID: "@alice:localhost",
			publicName: "Alice Cooper",
		};

		// TODO: set profile data for alice

		const resp = await app.handle(
			new Request(
				`http://localhost/_matrix/federation/v1/query/profile?user_id=${alice.userID}&field=displayname`,
			),
		);

		expect(resp.status).toBe(200);

		const content = await resp.json();
		expect(content).toHaveProperty("displayname", alice.publicName);
	});
});
