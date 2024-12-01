export function toBinaryData(value: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function fromBinaryData(value: string | Uint8Array | ArrayBuffer | ArrayBufferView): string {
  if (typeof value === "string") {
    return value;
  }

  return new TextDecoder().decode(value);
}

export function toUnpaddedBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/=+$/, "");
}
