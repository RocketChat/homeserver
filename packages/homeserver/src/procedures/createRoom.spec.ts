import { expect, test } from "bun:test";
import { createRoom } from "./createRoom";
import { createSignedEvent } from "@hs/core/src/events/utils/createSignedEvent";
import { generateKeyPairsFromString } from "../keys";

test("createRoom", async () => {
	const signature = await generateKeyPairsFromString(
		"ed25519 a_XRhW YjbSyfqQeGto+OFswt+XwtJUUooHXH5w+czSgawN63U",
	);

	const makeSignedEvent = createSignedEvent(signature, "hs1");

	const { roomId, events } = await createRoom(
		"@sender:hs1",
		"username",
		makeSignedEvent,
		"!roomId:hs1",
	);

	expect(events).toBeArrayOfSize(6);
});
