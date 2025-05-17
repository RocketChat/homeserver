import { expect, test } from "bun:test";
import { generateKeyPairsFromString } from "../../keys";
import { ClientRoomService } from "./room.service";
import { ConfigService } from "../config.service";
import { EventRepository } from "../../repositories/event.repository";
import { FederationRequestService } from "@hs/federation-sdk";

test("create - should create room events", async () => {
	const serverName = "hs1";
	const signingKey = await generateKeyPairsFromString(
		"ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U",
	);

	const mockConfigService = {
		getServerName: () => serverName,
		getSigningKey: async () => [signingKey]
	} as unknown as ConfigService;
	
	let capturedEvents: any[] = [];
	const mockEventRepository = {
		createMany: async (events: any[]) => {
			capturedEvents = events;
			return;
		},
		create: async () => {},
		find: async () => []
	} as unknown as EventRepository;
	
	const mockRequestService = {} as unknown as FederationRequestService;

	const roomService = new ClientRoomService(
		mockConfigService,
		mockEventRepository,
		mockRequestService
	);

	const username = "@username:hs1";
	const sender = "@sender:hs1";
	const result = await roomService.create(username, sender);

	expect(result).toBeDefined();
	expect(result.roomId).toBeString();
	expect(result.roomId).toStartWith("!");
	expect(result.roomId).toEndWith(`:${serverName}`);
	expect(result.events).toBeArray();
	expect(result.events).toHaveLength(6);
	
	expect(capturedEvents).toHaveLength(6);
});
