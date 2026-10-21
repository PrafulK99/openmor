import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

// AES-256-GCM for secrets at rest (merchant Dodo API keys, webhook secrets).
// Stored format: "v1:" + base64(iv[12] | authTag[16] | ciphertext).
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptionError extends Error {
  constructor() {
    // Deliberately vague: never echo the payload or the reason it failed.
    super("Unable to decrypt value");
    this.name = "DecryptionError";
  }
}

function resolveKey(key?: Buffer): Buffer {
  const resolved = key ?? Buffer.from(env().ENCRYPTION_KEY, "base64");
  if (resolved.length !== KEY_BYTES) {
    throw new Error(`Encryption key must be ${KEY_BYTES} bytes`);
  }
  return resolved;
}

/** Encrypt a UTF-8 string. Uses ENCRYPTION_KEY unless a key is passed (tests, rotation). */
export function encrypt(plaintext: string, key?: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolveKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

/** Decrypt a value from `encrypt`. Throws DecryptionError on tampering, a wrong key, or bad format. */
export function decrypt(payload: string, key?: Buffer): string {
  const resolvedKey = resolveKey(key);
  const [version, body, ...rest] = payload.split(":");
  if (version !== VERSION || body === undefined || rest.length > 0) {
    throw new DecryptionError();
  }

  const raw = Buffer.from(body, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptionError();
  }

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, resolvedKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}
