import { describe, expect, it, mock } from "bun:test";
import sinon from "sinon";

const stubs = {
  fetch: sinon.stub(),

  resolveHostname: sinon.stub(),
} as const;

import { getHomeserverFinalAddress } from "./discovery";

await mock.module("./discovery", () => ({
  resolveHostname: stubs.resolveHostname,
}));

// each function describes a stage of the spec to test spec conformity
// function returns the set of inputs to test with.
// each step should behave the same way so the modifications to the stub returns should not change.
//

type INPUT = string;
type OUTPUT = [`https://${string}:${string | number}`, { Host: string }];

/*
 * 1. If the hostname is an IP literal, then that IP address should be used, together with the given port number, or 8448 if no port is given. The target server must present a valid certificate for the IP address. The Host header in the request should be set to the server name, including the port if the server name included one.
 */

function spec_1__1(): [INPUT[], OUTPUT[]] {
  return [
    ["11.0.0.1", "11.0.0.1:45"],
    [
      ["https://11.0.0.1:8448" as const, { Host: "11.0.0.1" }],
      ["https://11.0.0.1:45" as const, { Host: "11.0.0.1:45" }],
    ],
  ];
}

function spec_1__2(): [INPUT[], OUTPUT[]] {
  return [
    ["[::1]", "[::1]:45"],
    [
      ["https://[::1]:8448" as const, { Host: "[::1]" }],
      ["https://[::1]:45" as const, { Host: "[::1]:45" }],
    ],
  ];
}

/*
 * SPEC:
 * 2. If the hostname is not an IP literal, and the server name includes an explicit port, resolve the hostname to an IP address using CNAME, AAAA or A records. Requests are made to the resolved IP address and given port with a Host header of the original server name (with port). The target server must present a valid certificate for the hostname.
 */

function spec_2__1(): [INPUT[], OUTPUT[]] {
  stubs.resolveHostname.resolves("11.0.0.1");
  return [
    ["example.com:45"],
    [["https://11.0.0.1:45" as const, { Host: "example.com:45" }]],
  ];
}

async function runTest(inputs: INPUT[], outputs: OUTPUT[]) {
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const output = outputs[i];

    const [address, headers] = await getHomeserverFinalAddress(input);

    expect(address).toBe(output[0]);
    expect(headers).toEqual(output[1]);
  }
}

describe("[Server Discovery 2.1 - resolve final address] https://spec.matrix.org/v1.12/server-server-api/#resolving-server-names", () => {
  it("2.1.1 (ipv4)", async () => {
    return runTest(...spec_1__1());
  });

  it("2.1.1 (ipv6)", async () => {
    return runTest(...spec_1__2());
  });

  it("2.1.2 (ipv4)", async () => {
    return runTest(...spec_2__1());
  });
});
