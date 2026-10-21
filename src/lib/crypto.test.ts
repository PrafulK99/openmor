import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DecryptionError, decrypt, encrypt } from "@/lib/crypto";

const key = randomBytes(32);
const secret = "dodo_test_sk_1234567890abcdef";

function flipByte(payload: string, offset: number): string {
  const [version, body] = payload.split(":");
  const raw = Buffer.from(body!, "base64");
  raw[offset]! ^= 0x01;
  return `${version}:${raw.toString("base64")}`;
}

describe("encrypt/decrypt", () => {
  it("round-trips a value", () => {
    const payload = encrypt(secret, key);
    expect(payload).toMatch(/^v1:/);
    expect(payload).not.toContain(secret);
    expect(decrypt(payload, key)).toBe(secret);
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt(secret, key)).not.toBe(encrypt(secret, key));
  });

  it("rejects a tampered ciphertext", () => {
    const payload = encrypt(secret, key);
    // Byte 28 is the first ciphertext byte (after 12-byte IV and 16-byte tag).
    expect(() => decrypt(flipByte(payload, 28), key)).toThrow(DecryptionError);
  });

  it("rejects a tampered auth tag", () => {
    const payload = encrypt(secret, key);
    expect(() => decrypt(flipByte(payload, 12), key)).toThrow(DecryptionError);
  });

  it("rejects a wrong key", () => {
    const payload = encrypt(secret, key);
    expect(() => decrypt(payload, randomBytes(32))).toThrow(DecryptionError);
  });

  it("rejects malformed payloads", () => {
    expect(() => decrypt("not-a-payload", key)).toThrow(DecryptionError);
    expect(() => decrypt("v2:abcd", key)).toThrow(DecryptionError);
    expect(() => decrypt("v1:", key)).toThrow(DecryptionError);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encrypt(secret, randomBytes(16))).toThrow(/32 bytes/);
  });
});
