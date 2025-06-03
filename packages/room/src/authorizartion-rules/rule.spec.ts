import { it, describe, expect } from "bun:test";
import {
	PersistentEventBase,
	PersistentEventFactory,
} from "../manager/event-manager";
import type { PduV1 } from "../types/v1";
import { isAllowedEvent } from "./rule";
import type { EventStore } from "../state_resolution/definitions/definitions";

class MockStore implements EventStore {
	events: Map<string, PersistentEventBase> = new Map();

	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return eventIds.map((id) => this.events.get(id) as PersistentEventBase);
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map();
		for (const event of this.events.values()) {
			byHash.set(event.sha256hash, event);
		}
		return hashes.map((h) => byHash.get(h) as PersistentEventBase);
	}
}

const store = new MockStore();

describe("authorization rules", () => {
	// https://spec.matrix.org/v1.3/rooms/v9/#authorization-rules
	// 1: If type is m.room.create:
	// 1. If it has any previous events, reject.

	it("should reject a create event with prev_events", () => {
		const createEvent = PersistentEventFactory.create(
			{
				type: "m.room.create",
				state_key: "",
				content: {
					creator: "alice",
					room_version: "1",
				},
				auth_events: [],
				prev_events: ["$somefakeevent"],
			} as unknown as PduV1,
			1,
		);
	});

	/*
        https://spec.matrix.org/v1.3/rooms/v9/#authorization-rules
        2. Reject if event has auth_events that:
            1. have duplicate entries for a given type and state_key pair
	*/
	it("should reject an event with duplicate auth_events", async () => {
		const anotherFakeEvent = PersistentEventFactory.create(
			{
				type: "m.room.member",
				state_key: "@alice:example.com",
				auth_events: [],
				event_id: "$somefakeevent",
				content: {
					membership: "join",
				},
			} as unknown as PduV1,
			1,
		);
		const fakeEvent = PersistentEventFactory.create(
			{
				event_id: "$somefakeevent2",
				type: "m.room.member",
				state_key: "@alice:example.com",
				auth_events: ["$somefakeevent", "$somefakeevent"],
				content: {
					membership: "join",
				},
			} as unknown as PduV1,
			1,
		);
		store.events.set("$somefakeevent", anotherFakeEvent);
		store.events.set("$somefakeevent2", fakeEvent);
		expect(await isAllowedEvent(fakeEvent, store)).toBe(false);
	});

	it("should reject an event if has more than necessary auth_events", async () => {
		// create event
		// join event
		// power level event
		// join rules event

		const createEvent = PersistentEventFactory.create(
			{
				event_id: "$create",
				type: "m.room.create",
				state_key: "",
				content: {
					creator: "alice",
					room_version: "1",
				},
				auth_events: [],
				prev_events: [],
			} as unknown as PduV1,
			1,
		);

		const joinEvent = PersistentEventFactory.create(
			{
				event_id: "$join",
				type: "m.room.member",
				state_key: "@alice:example.com",
				content: {
					membership: "join",
				},
				auth_events: [],
				prev_events: [],
			} as unknown as PduV1,
			1,
		);

		const powerLevelEvent = PersistentEventFactory.create(
			{
				event_id: "$power_levels",
				type: "m.room.power_levels",
				state_key: "",
				content: {
					users: {
						"@alice:example.com": 100,
					},
				},
				auth_events: [],
				prev_events: [],
			} as unknown as PduV1,
			1,
		);

		const joinRulesEvent = PersistentEventFactory.create(
			{
				event_id: "$join_rules",
				type: "m.room.join_rules",
				state_key: "",
				content: {
					join_rule: "invite",
				},
				auth_events: [],
				prev_events: [],
			} as unknown as PduV1,
			1,
		);

		store.events.set("$create", createEvent);
		store.events.set("$join", joinEvent);
		store.events.set("$power_levels", powerLevelEvent);
		store.events.set("$join_rules", joinRulesEvent);
	});
});
