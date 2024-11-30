export function unpaddedBase64(value: Uint8Array | string) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value)
      .toString("base64")
      .replace(/=+$/, "");
  }

  return value.replace(/=+$/, "");
}
