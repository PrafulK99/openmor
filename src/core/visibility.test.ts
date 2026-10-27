import { describe, expect, it } from "vitest";
import { isMerchantVisible, isTestMerchant, markTest, TEST_MARKER, TEST_NOTE, visibleMerchantWhere } from "@/core/visibility";
import { includeTestMerchants } from "@/lib/env";

const live = { dodoEnvironment: "live_mode" as const, liveModeEnabled: true, networkOptIn: true };

describe("isTestMerchant", () => {
  it("is live only with the live environment AND the explicit live flag", () => {
    expect(isTestMerchant(live)).toBe(false);
    expect(isTestMerchant({ ...live, liveModeEnabled: false })).toBe(true);
    expect(isTestMerchant({ ...live, dodoEnvironment: "test_mode" })).toBe(true);
    expect(isTestMerchant({ dodoEnvironment: "test_mode", liveModeEnabled: false })).toBe(true);
  });
});

describe("isMerchantVisible / visibleMerchantWhere", () => {
  const testMode = { ...live, dodoEnvironment: "test_mode" as const };

  it("hides test merchants unless the deployment includes them", () => {
    expect(isMerchantVisible({}, live)).toBe(true);
    expect(isMerchantVisible({}, testMode)).toBe(false);
    expect(isMerchantVisible({ includeTestMerchants: false }, testMode)).toBe(false);
    expect(isMerchantVisible({ includeTestMerchants: true }, testMode)).toBe(true);
  });

  it("never shows a merchant that has not opted in, whatever the flag", () => {
    expect(isMerchantVisible({ includeTestMerchants: true }, { ...live, networkOptIn: false })).toBe(false);
    expect(isMerchantVisible({}, { ...live, networkOptIn: false })).toBe(false);
  });

  it("builds the matching database filter", () => {
    expect(visibleMerchantWhere({})).toEqual({ networkOptIn: true, dodoEnvironment: "live_mode", liveModeEnabled: true });
    expect(visibleMerchantWhere({ includeTestMerchants: true })).toEqual({ networkOptIn: true });
  });
});

describe("markers are fixed strings", () => {
  it("prefixes only test products", () => {
    expect(markTest("Pro", true)).toBe(`${TEST_MARKER} Pro`);
    expect(markTest("Pro", false)).toBe("Pro");
    expect(TEST_NOTE).toMatch(/^TEST CATALOG/);
  });
});

describe("includeTestMerchants (env flag)", () => {
  it("is on only for exactly \"true\"", () => {
    expect(includeTestMerchants({ PUBLIC_INCLUDE_TEST_MERCHANTS: "true" })).toBe(true);
    for (const v of [undefined, "", "false", "TRUE", "True", "1", "yes", " true"]) {
      expect(includeTestMerchants({ PUBLIC_INCLUDE_TEST_MERCHANTS: v })).toBe(false);
    }
  });
});
