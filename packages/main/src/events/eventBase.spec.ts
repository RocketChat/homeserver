import { expect, test } from "bun:test";

import { roomCreateEvent } from "./m.room.create";
import { generateKeyPairs } from "../keys";
import { generateId } from "../authentication";
import { signEvent } from "../signEvent";
import { createEventBase } from "./eventBase";

const finalEventId = "$0AQU5dG_mtjH6qavAxYrQsDC0a_-6T3DHs1yoxf5fz4";
const finalEvent = {
    auth_events: [],
    prev_events: [],
    type: "m.room.create",
    room_id: "!uTqsSSWabZzthsSCNf:hs1",
    sender: "@admin:hs1",
    content: {
        room_version: "10",
        creator: "@admin:hs1",
    },
    depth: 1,
    state_key: "",
    origin: "hs1",
    origin_server_ts: 1733107418648,

    hashes: { sha256: "XFkxvgXOT9pGz5Hbdo7tLlVN2SmWhQ9ifgsbLio/FEo" },

    signatures: {
        hs1: {
            "ed25519:a_HDhg":
                "rmnvsWlTL+JP8Sk9767UR0svF4IrzC9zhUPbT+y4u31r/qtIaF9OtT1FP8tD/yFGD92qoTcRb4Oo8DRbLRXcAg",
        },
    },
    unsigned: { age_ts: 1733107418648 },
};

test("eventBase - invalid sender (without ':' )", async () => {

    expect(() => createEventBase<{}, {}>({
        roomId: '',
        sender: 'invalid',
        auth_events: [],
        prev_events: [],
        depth: 1,
        type: "m.room.member",
        content: {
        },
        state_key: 'sender',
        origin_server_ts: 12,
        unsigned: { age_ts: 12 },
    })).toThrowError("Invalid sender");

});

test("eventBase -  invalid sender (without '@' )", async () => {

    expect(() => createEventBase<{}, {}>({
        roomId: '',
        sender: 'invalid:invalid',
        auth_events: [],
        prev_events: [],
        depth: 1,
        type: "m.room.member",
        content: {
        },
        state_key: 'sender',
        origin_server_ts: 12,
        unsigned: { age_ts: 12 },
    })).toThrowError("Invalid sender");

});

test("eventBase -  invalid roomId (without '!' )", async () => {

    expect(() => createEventBase<{}, {}>({
        roomId: 'invalid',
        sender: '@valid:valid',
        auth_events: [],
        prev_events: [],
        depth: 1,
        type: "m.room.member",
        content: {
        },
        state_key: 'sender',
        origin_server_ts: 12,
        unsigned: { age_ts: 12 },
    })).toThrowError("Invalid room Id");

});

test("eventBase -  invalid roomId (without '!' )", async () => {

    expect(() => createEventBase<{}, {}>({
        roomId: 'invalid:invalid',
        sender: '@valid:valid',
        auth_events: [],
        prev_events: [],
        depth: 1,
        type: "m.room.member",
        content: {
        },
        state_key: 'sender',
        origin_server_ts: 12,
        unsigned: { age_ts: 12 },
    })).toThrowError("Invalid room Id");

});