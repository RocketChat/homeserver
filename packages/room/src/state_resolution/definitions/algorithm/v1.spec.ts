import { afterEach, describe, it } from 'bun:test';
import { resolveStateV1 } from "./v1";
import { type EventStore } from "../definitions";
import { type PersistentEventBase } from "../../../manager/event-manager";
import { PersistentEventFactory } from "../../../manager/factory";

class MockEventStore implements EventStore {
	public events: Array<PersistentEventBase> = [];
	async getEvents(eventIds: string[]): Promise<PersistentEventBase[]> {
		return this.events.filter((e) => eventIds.includes(e.eventId));
	}

	async getEventsByHashes(hashes: string[]): Promise<PersistentEventBase[]> {
		const byHash = new Map<string, PersistentEventBase>();
		for (const event of this.events) {
			byHash.set(event.sha256hash, event);
		}
		return hashes.map((hash) => byHash.get(hash)!);
	}

	toMap(): Map<string, PersistentEventBase> {
		return new Map(this.events.map((e) => [e.eventId, e]));
	}
}

const eventStore = new MockEventStore();

describe("resolveStateV1", () => {
	it("should resolve the state", async () => {
		const events = [
			{
				event_id: "START",
				type: "m.room.create",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 1,
				prev_events: [],
				state_key: "",
				content: {},
				signatures: {},
				unsigned: {},
			},
			{
				event_id: "A",
				type: "m.room.message",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 2,
				prev_events: ["START"],
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "B",
				type: "m.room.message",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 3,
				prev_events: ["A"],
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "C",
				type: "m.room.name",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 3,
				prev_events: ["A"],
				state_key: "",
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "D",
				type: "m.room.message",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 4,
				prev_events: ["B", "C"],
				signatures: {},
				unsigned: {},
			},
		];

		for (const event of events) {
			eventStore.events.push(PersistentEventFactory.create(event as any, 1));
		}

		const state = await resolveStateV1(
			eventStore.events.filter((e) => e.isState()),
			eventStore,
		);

		console.log(
			state
				.values()
				.map((v) => v.event)
				.toArray(),
		);
	});

	afterEach(() => {
		eventStore.events = [];
	});

	it("should resolve the state with a conflict", async () => {
		const events = [
			{
				event_id: "START",
				type: "m.room.create",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 1,
				prev_events: [],
				state_key: "",
				content: { creator: "@user_id:example.com" },
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "A",
				type: "m.room.member",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 2,
				prev_events: ["START"],
				state_key: "@user_id:example.com",
				content: { membership: "join" },
				membership: "join",
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "B",
				type: "m.room.name",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 3,
				prev_events: ["A"],
				state_key: "",
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "C",
				type: "m.room.name",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 4,
				prev_events: ["A"],
				state_key: "",
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "D",
				type: "m.room.message",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 5,
				prev_events: ["B", "C"],
				signatures: {},
				unsigned: {},
			},
		];

		for (const event of events) {
			eventStore.events.push(PersistentEventFactory.create(event as any, 1));
		}

		const state = await resolveStateV1(
			eventStore.events.filter((e) => e.isState()),
			eventStore,
		);

		console.log(
			state
				.values()
				.map((v) => v.event)
				.toArray(),
		);
	});

	it("ban conflict", async () => {
		const events = [
			{
				event_id: "START",
				type: "m.room.create",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 1,
				prev_events: [],
				auth_events: [],
				state_key: "",
				content: { creator: "@user_id:example.com" },
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "A",
				type: "m.room.member",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 2,
				prev_events: ["START"],
				auth_events: ["START"],
				state_key: "@user_id:example.com",
				content: { membership: "join" },
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "B",
				type: "m.room.name",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 3,
				prev_events: ["A"],
				auth_events: ["START", "A"],
				state_key: "",
				content: { name: "Room Name" },
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "C",
				type: "m.room.member",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 4,
				prev_events: ["B"],
				auth_events: ["START", "A", "B"],
				state_key: "@user_id_2:example.com",
				content: { membership: "ban" },
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "D",
				type: "m.room.name",
				sender: "@user_id_2:example.com",
				room_id: "!room_id:example.com",
				depth: 4,
				prev_events: ["B"],
				state_key: "",
				auth_events: ["START", "A", "B", "C"],
				signatures: {},
				unsigned: {},
			},

			{
				event_id: "E",
				type: "m.room.message",
				sender: "@user_id:example.com",
				room_id: "!room_id:example.com",
				depth: 5,
				prev_events: ["C", "D"],
				auth_events: ["START", "A", "B", "C", "D"],
				signatures: {},
				unsigned: {},
			},
		];

		for (const event of events) {
			eventStore.events.push(PersistentEventFactory.create(event as any, 1));
		}

		const state = await resolveStateV1(
			eventStore.events.filter((e) => e.isState()),
			eventStore,
		);

		console.log(
			state
				.values()
				.map((v) => v.event)
				.toArray(),
		);
	});
});
