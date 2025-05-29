import { expect, test } from "bun:test";

import { generateId } from "../../../homeserver/src/authentication";
import { generateKeyPairsFromString } from "../../../homeserver/src/keys";
import { signEvent } from "../../../homeserver/src/signEvent";
import { redactionEvent } from "./m.room.redaction";

const finalEvent = {
    auth_events: [
        "$lBxmA2J-6fGfOjUZ6dPCanOdBdkawli08Jf1IuH8aso",
        "$mxzNPfcqEDUUuWm7xs44NguWJ3A2nWu6UxXt4TlX-T8",
        "$TK2UQZ-AEsSoIIRoTKYBTf9c1wW8X3AmjLhnuiSnDmY"
    ],
    prev_events: ["$8ftnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA"],
    type: "m.room.redaction",
    room_id: "!MZyyuzkUwHEaBBOXai:hs1",
    sender: "@user:rc1",
    depth: 4,
    origin: "rc1",
    origin_server_ts: 1747837631863,
    content: {
        reason: "Inappropriate content"
    },
    redacts: "$8ftnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA"
};

test("redactionEvent", async () => {
    const signature = await generateKeyPairsFromString(
        "ed25519 a_HDhg WntaJ4JP5WbZZjDShjeuwqCybQ5huaZAiowji7tnIEw",
    );

    const { state_key: redactionStateKey, ...redaction } = redactionEvent({
        roomId: "!MZyyuzkUwHEaBBOXai:hs1",
        sender: "@user:rc1",
        auth_events: {
            "m.room.create": "$lBxmA2J-6fGfOjUZ6dPCanOdBdkawli08Jf1IuH8aso",
            "m.room.power_levels": "$mxzNPfcqEDUUuWm7xs44NguWJ3A2nWu6UxXt4TlX-T8",
            "m.room.member": "$TK2UQZ-AEsSoIIRoTKYBTf9c1wW8X3AmjLhnuiSnDmY",
        },
        prev_events: ["$8ftnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA"],
        depth: 4,
        content: {
            redacts: "$8ftnUd9WTPTQGbdPgfOPea8bOEQ21qPvbcGqeOApQxA",
            reason: "Inappropriate content"
        },
        origin: "rc1",
        ts: 1747837631863,
    });

    const signedRedaction = await signEvent(redaction, signature, "rc1");
    const redactionEventId = generateId(signedRedaction);

    expect(signedRedaction).toMatchObject(finalEvent);
    expect(redactionEventId).toBeDefined();
});
