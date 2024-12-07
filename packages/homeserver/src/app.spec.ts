import { describe, expect, it } from "bun:test";
import { app } from "./app";

describe("TestRootApp", () => {
	it("Non existing routes should return 404 and expected content", async () => {
		const resp = await app.handle(
			new Request("http://localhost/any-non-existing-route"),
		);

		expect(resp.status).toBe(404);
		expect(await resp.text()).toBe(
			JSON.stringify({
				errcode: "M_UNRECOGNIZED",
				error: "Unrecognized request",
			}),
		);
	});
});
