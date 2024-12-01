import { expect, it } from "bun:test";
import nacl from "tweetnacl";
import { app } from "../../../app";
import { fromBinaryData, toBinaryData } from "../../../binaryData";

it("TestInboundFederationKeys", async () => {
  const resp = await app.handle(
    new Request(`http://${app.config.name}/_matrix/key/v2/server`)
  );

  expect(resp.status).toBe(200);

  const body = await resp.arrayBuffer();

  const jsonObj = JSON.parse(fromBinaryData(body));
  expect(jsonObj).toHaveProperty("valid_until_ts");
  expect(jsonObj.valid_until_ts).toBeNumber();
  expect(jsonObj).toHaveProperty("server_name", app.config.name);

  // Check validity of verify_keys+old_verify_keys and store values

  const keys = new Map<string, Uint8Array>();
  const oldKeys = new Map<string, Uint8Array>();

  expect(jsonObj).toHaveProperty("verify_keys");
  for (const [k, v] of Object.entries(jsonObj.verify_keys)) {
    expect(k).toStartWith("ed25519:");

    expect(v).toEqual(
      expect.objectContaining({
        key: expect.any(String),
      })
    );

    const key = (v as { key: string }).key;
    const keyBytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    keys.set(k, keyBytes);
  }

  expect(jsonObj).toHaveProperty("old_verify_keys");
  for (const [k, v] of Object.entries(jsonObj.old_verify_keys)) {
    expect(k).toStartWith("ed25519:");
    expect(v).toEqual(
      expect.objectContaining({
        expired_ts: expect.any(Number),
        key: expect.any(String),
      })
    );

    const key = (v as { key: string }).key;
    const keyBytes = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    keys.set(k, keyBytes);
  }

  expect(jsonObj).toHaveProperty("signatures");
  for (const v of Object.values(jsonObj.signatures)) {
    expect(v).toBeObject();

    for (const [key, value] of Object.entries(v as object)) {
      expect(key).toStartWith("ed25519:");
      expect(value).toBeString();
      expect(() => atob(value)).not.toThrow();
    }
  }

  expect(jsonObj.valid_until_ts).toBeGreaterThan(Date.now());

  await checkKeysAndSignatures(jsonObj, keys, oldKeys);
});

async function checkKeysAndSignatures(
  jsonObj: any,
  keys: Map<string, Uint8Array>,
  oldKeys: Map<string, Uint8Array>
) {
  expect(keys).not.toBeEmpty();
  // Check if any old key exists in the new keys
  for (const key of keys.keys()) {
    expect(oldKeys.has(key)).toBeFalse();
  }

  const sigObj = jsonObj.signatures;
  // Test signatures object sanity
  expect(sigObj).toContainKey(app.config.name);
  expect(Object.keys(sigObj)).toHaveLength(1);

  const sigServerObj = sigObj[app.config.name!];

  const signatures = new Map<
    string,
    {
      signature: Uint8Array;
      key: Uint8Array;
      old: boolean;
    }
  >();

  // Test signatures for all verify_keys, these *have* to exist.
  for (const [keyName, keyBytes] of keys) {
    const sigBase64 = sigServerObj[keyName];
    const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));
    signatures.set(keyName, { key: keyBytes, signature: sigBytes, old: false });
  }

  // Check if there's any leftover signatures, add them if they exist in the expired keys
  for (const [keyName, sig] of Object.entries(sigServerObj)) {
    if (signatures.has(keyName)) {
      continue;
    }

    // Found a signature that was leftover, this *should* be an expired key, if not, abort.
    const keyBytes = oldKeys.get(keyName)!;
    expect(sig).toBeString();

    const sigBytes = Uint8Array.from(atob(sig as string), (c) =>
      c.charCodeAt(0)
    );

    signatures.set(keyName, { key: keyBytes, signature: sigBytes, old: true });
  }

  const bodyWithoutSig = (() => {
    const { signatures, ...rest } = jsonObj;
    return toBinaryData(JSON.stringify(rest));
  })();

	for (const val of signatures.values()) {
    expect(nacl.sign.detached.verify(bodyWithoutSig, val.signature, val.key)).toBeTrue();
	}
}
