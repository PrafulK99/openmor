import { describe, expect, it } from "vitest";
import { encrypt, DecryptionError } from "@/lib/crypto";
import { TEST_ENCRYPTION_KEY } from "@/test/keys";
import { createAdapterFor, environmentFor } from "./index";
import { DodoAdapter } from "./dodo";

const encrypted = encrypt("dodo_test_sk_abc", TEST_ENCRYPTION_KEY);

describe("environmentFor", () => {
  it("uses live mode only when both the environment and the live flag say so", () => {
    expect(environmentFor({ dodoApiKeyEncrypted: "", dodoEnvironment: "live_mode", liveModeEnabled: true })).toBe("live_mode");
    expect(environmentFor({ dodoApiKeyEncrypted: "", dodoEnvironment: "live_mode", liveModeEnabled: false })).toBe("test_mode");
    expect(environmentFor({ dodoApiKeyEncrypted: "", dodoEnvironment: "test_mode", liveModeEnabled: true })).toBe("test_mode");
    expect(environmentFor({ dodoApiKeyEncrypted: "", dodoEnvironment: "test_mode", liveModeEnabled: false })).toBe("test_mode");
  });
});

describe("createAdapterFor", () => {
  const adapterFor = createAdapterFor({ encryptionKey: TEST_ENCRYPTION_KEY });

  it("decrypts the key and builds a Dodo adapter in the merchant's environment", () => {
    const a = adapterFor({ dodoApiKeyEncrypted: encrypted, dodoEnvironment: "live_mode", liveModeEnabled: false });
    expect(a).toBeInstanceOf(DodoAdapter);
    expect((a as DodoAdapter).environment).toBe("test_mode");
  });

  it("fails on ciphertext from another key", () => {
    const foreign = encrypt("dodo_test_sk_abc", Buffer.alloc(32, 1));
    expect(() =>
      adapterFor({ dodoApiKeyEncrypted: foreign, dodoEnvironment: "test_mode", liveModeEnabled: false }),
    ).toThrow(DecryptionError);
  });
});
