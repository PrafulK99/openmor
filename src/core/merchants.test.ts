import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, OpenMorError, ProviderError } from "@/core/errors";
import { createMerchant, getMerchantBySlug, setNetworkOptIn, setWebhookSecret } from "@/core/merchants";
import { decrypt } from "@/lib/crypto";
import { setup } from "@/test/core-fixtures";
import { TEST_ENCRYPTION_KEY } from "@/test/keys";

vi.mock("@/lib/env", async () => {
  const { TEST_ENCRYPTION_KEY_B64: key } = await import("@/test/keys");
  return { env: () => ({ ENCRYPTION_KEY: key }) };
});

const KEY = "dodo_test_sk_PLAINTEXT_abc123";
const input = { name: "ShareThings", slug: "ShareThings", email: "Owner@ShareThings.test", dodoApiKey: KEY };

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

describe("createMerchant", () => {
  it("stores the key encrypted, never in plain text", async () => {
    await createMerchant(t.deps, input);
    const [row] = t.db.tables.merchant;
    expect(row!.dodoApiKeyEncrypted).toMatch(/^v1:/);
    expect(JSON.stringify(t.db.tables)).not.toContain(KEY);
    expect(decrypt(row!.dodoApiKeyEncrypted as string, TEST_ENCRYPTION_KEY)).toBe(KEY);
  });

  it("never returns the key or its ciphertext", async () => {
    const m = await createMerchant(t.deps, input);
    expect(Object.keys(m)).not.toContain("dodoApiKeyEncrypted");
    expect(JSON.stringify(m)).not.toContain(KEY);
    expect(m).toMatchObject({
      slug: "sharethings",
      email: "owner@sharethings.test",
      dodoEnvironment: "test_mode",
      liveModeEnabled: false,
      networkOptIn: false,
    });
  });

  it("validates the key with one listProducts call, in test mode, before storing", async () => {
    await createMerchant(t.deps, input);
    expect(t.adapter.listProducts).toHaveBeenCalledTimes(1);
    const config = t.adapterFor.mock.calls[0]![0];
    expect(config).toMatchObject({ dodoEnvironment: "test_mode", liveModeEnabled: false });
    // The factory receives ciphertext, not the plain key.
    expect(JSON.stringify(config)).not.toContain(KEY);
  });

  it("stores nothing when the provider rejects the key", async () => {
    t.adapter.listProducts.mockRejectedValueOnce(new ProviderError("Dodo Payments", 401, "Unauthorized"));
    await expect(createMerchant(t.deps, input)).rejects.toMatchObject({ code: "PROVIDER_ERROR", status: 401 });
    expect(t.db.tables.merchant).toHaveLength(0);
  });

  it("rejects bad input without echoing values", async () => {
    const err = await createMerchant(t.deps, { ...input, slug: "bad slug!", dodoApiKey: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(InvalidInputError);
    expect(err.message).toContain("slug");
    expect(err.message).toContain("dodoApiKey");
    expect(t.adapter.listProducts).not.toHaveBeenCalled();
  });

  it("refuses a duplicate slug", async () => {
    await createMerchant(t.deps, input);
    await expect(createMerchant(t.deps, { ...input, email: "other@x.test" })).rejects.toThrow(/already exists/);
  });
});

describe("getMerchantBySlug / setNetworkOptIn", () => {
  it("finds by slug and opts in", async () => {
    const m = await createMerchant(t.deps, input);
    expect((await getMerchantBySlug(t.deps, "SHARETHINGS")).id).toBe(m.id);
    expect((await setNetworkOptIn(t.deps, m.id, true)).networkOptIn).toBe(true);
  });

  it("throws MERCHANT_NOT_FOUND for an unknown slug", async () => {
    const err = await getMerchantBySlug(t.deps, "nope").catch((e) => e);
    expect(err).toBeInstanceOf(OpenMorError);
    expect(err.code).toBe("MERCHANT_NOT_FOUND");
  });
});

describe("setWebhookSecret", () => {
  const SECRET = `whsec_${Buffer.alloc(32, 5).toString("base64")}`;

  it("stores the secret encrypted and never returns it", async () => {
    const m = await createMerchant(t.deps, input);
    const view = await setWebhookSecret(t.deps, m.id, `  ${SECRET} `);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    const stored = t.db.tables.merchant[0]!.dodoWebhookSecretEncrypted as string;
    expect(stored).toMatch(/^v1:/);
    expect(JSON.stringify(t.db.tables)).not.toContain(SECRET);
    expect(decrypt(stored, TEST_ENCRYPTION_KEY)).toBe(SECRET);
  });

  it("rejects something that is not a whsec_ secret", async () => {
    const m = await createMerchant(t.deps, input);
    await expect(setWebhookSecret(t.deps, m.id, "dodo_test_sk_oops")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
