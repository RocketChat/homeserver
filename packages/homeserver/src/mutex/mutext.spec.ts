import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Mutex, type Lock } from "./Mutex";

describe("Mutex", () => {
	let mutex: Mutex;
	let lock: Lock | false;

	beforeEach(() => {
		mutex = new Mutex();
	});

	afterEach(() => {
		if (lock) {
			lock.release();
		}
	});

	it("should grant a lock if the scope is not already locked", async () => {
		const scope = "test-scope";
		lock = await mutex.request(scope);
		expect(lock).toBeTruthy();
	});

	it("should not grant a lock if the scope is already locked", async () => {
		const scope = "test-scope";
		await mutex.request(scope);
		const secondLock = await mutex.request(scope);
		expect(secondLock).toBeFalsy();
	});

	it("should release a lock and allow re-locking the same scope", async () => {
		const scope = "test-scope";
		lock = await mutex.request(scope);
		expect(lock).not.toBeFalse();

		await (lock as Lock).release();

		const newLock = await mutex.request(scope);
		expect(newLock).toBeTruthy();
	});
});
