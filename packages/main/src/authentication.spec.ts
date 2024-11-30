import { expect, test } from "bun:test";

import { signRequest } from "./authentication";
import { signJson, signText } from "./signJson";
import { generateKeyPairs } from "./keys";

// {
//     "content": {
//         "auth_events": [
//             "$aokhD3KlL_EHZ67626nn_aHMPW9K3T7rvT7IkrZaMbI",
//             "$-aRadmHs-xyc4xVWx38FmlIaM6xafoJsqCj3fVbkO-Q",
//             "$NAL56UfuEcLlL2kjmOYZvd5dQJY59Sxxp3l42iBNenw",
//             "$smcGuuNx478aANd8STTp0bDI94ER93vldR-_mO_KLyU"
//         ],
//         "content": {
//             "membership": "join"
//         },
//         "depth": 10,
//         "hashes": {
//             "sha256": "YBZHC60WOdOVDB2ISkVTnbg/L7J9qYBKWY+lUSZYIUk"
//         },
//         "origin": "synapse2",
//         "origin_server_ts": 1732999153019,
//         "prev_events": [
//             "$UqTWV2zA0fLTB2gj9iemXVyjamrt5X6GsSTnCQAtmik"
//         ],
//         "room_id": "!JVkUxGlBLsuOwTBUpN:synapse1",
//         "sender": "@rodrigo2:synapse2",
//         "signatures": {
//             "synapse2": {
//                 "ed25519:a_yNbw": "NKSz4x8fKwoNOOY/rcVVkVrzzt/TyFaL+8IJX9raSZNrMZFH5J3s2l+Z85q8McAUPp/pKKctI4Okk0Q7Q8OOBA"
//             }
//         },
//         "state_key": "@rodrigo2:synapse2",
//         "type": "m.room.member",
//         "unsigned": {
//             "age": 2
//         }
//     },
//     "destination": "synapse1",
//     "method": "PUT",
//     "origin": "synapse2",
//     "signatures": {
//         "synapse2": {
//             "ed25519:a_yNbw": "lxdmBBy9OtgsmRDbm1I3dhyslE4aFJgCcg48DBNDO0/rK4d7aUX3YjkDTMGLyugx9DT+s34AgxnBZOWRg1u6AQ"
//         }
//     },
//     "uri": "/_matrix/federation/v2/send_join/%21JVkUxGlBLsuOwTBUpN%3Asynapse1/%24UOFwq4Soj_komm7BQx5zhf-AmXiPw1nkTycvdlFT5tk?omit_members=true"
// }

test("signRequest", async () => {
  const [signature] = await generateKeyPairs(
    Uint8Array.from(atob("tBD7FfjyBHgT4TwhwzvyS9Dq2Z9ck38RRQKaZ6Sz2z8"), (c) =>
      c.charCodeAt(0)
    )
  );

  const signed = await signJson(
    {
      auth_events: [
        "$aokhD3KlL_EHZ67626nn_aHMPW9K3T7rvT7IkrZaMbI",
        "$-aRadmHs-xyc4xVWx38FmlIaM6xafoJsqCj3fVbkO-Q",
        "$NAL56UfuEcLlL2kjmOYZvd5dQJY59Sxxp3l42iBNenw",
        "$smcGuuNx478aANd8STTp0bDI94ER93vldR-_mO_KLyU",
      ],
      prev_events: ["$UqTWV2zA0fLTB2gj9iemXVyjamrt5X6GsSTnCQAtmik"],
      type: "m.room.member",
      room_id: "!JVkUxGlBLsuOwTBUpN:synapse1",
      sender: "@rodrigo2:synapse2",
      depth: 10,

      content: {
        membership: "join",
      },

      hashes: {
        sha256: "YBZHC60WOdOVDB2ISkVTnbg/L7J9qYBKWY+lUSZYIUk",
      },
      origin: "synapse2",
      origin_server_ts: 1732999153019,

      state_key: "@rodrigo2:synapse2",
      unsigned: {
        age: 2,
      },
    },
    {
      algorithm: "ed25519",
      version: "a_yNbw",
      sign(data: Uint8Array) {
        return signText(data, signature.privateKey);
      },
    },
    "synapse2"
  );

  expect(signed).toHaveProperty("signatures");
  expect(signed.signatures).toBeObject();
  expect(signed.signatures).toHaveProperty("synapse2");
  expect(signed.signatures["synapse2"]).toBeObject();
  expect(signed.signatures["synapse2"]).toHaveProperty("ed25519:a_yNbw");
  expect(signed.signatures["synapse2"]["ed25519:a_yNbw"]).toBeString();

  expect(signed.signatures["synapse2"]["ed25519:a_yNbw"]).toBe(
    "NKSz4x8fKwoNOOY/rcVVkVrzzt/TyFaL+8IJX9raSZNrMZFH5J3s2l+Z85q8McAUPp/pKKctI4Okk0Q7Q8OOBA"
  );

  Object.assign(signed.content, {
    avatar_url: null,
    displayname: "rodrigo2",
  });
  const signedRequest = await signRequest(
    "synapse2",
    {
      algorithm: "ed25519",
      version: "a_yNbw",
      sign(data: Uint8Array) {
        return signText(data, signature.privateKey);
      },
    },
    "synapse1",
    "PUT",
    "/_matrix/federation/v2/send_join/%21JVkUxGlBLsuOwTBUpN%3Asynapse1/%24UOFwq4Soj_komm7BQx5zhf-AmXiPw1nkTycvdlFT5tk?omit_members=true",
    signed
  );

  expect(signedRequest).toBeObject();
  expect(signedRequest).toHaveProperty("signatures");
  expect(signedRequest.signatures).toBeObject();
  expect(signedRequest.signatures).toHaveProperty("synapse2");
  expect(signedRequest.signatures["synapse2"]).toBeObject();
  expect(signedRequest.signatures["synapse2"]).toHaveProperty("ed25519:a_yNbw");
  expect(signedRequest.signatures["synapse2"]["ed25519:a_yNbw"]).toBeString();

  expect(signedRequest.signatures["synapse2"]["ed25519:a_yNbw"]).toBe(
    "lxdmBBy9OtgsmRDbm1I3dhyslE4aFJgCcg48DBNDO0/rK4d7aUX3YjkDTMGLyugx9DT+s34AgxnBZOWRg1u6AQ"
  );
});
