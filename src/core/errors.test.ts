import { describe, expect, it } from "vitest";
import { NotImplementedError, OpenMorError, ProviderError } from "@/core/errors";

describe("ProviderError", () => {
  it("is an OpenMorError with the PROVIDER_ERROR code", () => {
    const err = new ProviderError("Dodo Payments", 404, "Not found");
    expect(err).toBeInstanceOf(OpenMorError);
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.message).toBe("Dodo Payments returned HTTP 404: Not found");
  });

  it("describes errors without a status", () => {
    expect(new ProviderError("Dodo Payments", undefined, "timeout").message).toBe(
      "Dodo Payments request failed: timeout",
    );
  });
});

describe("NotImplementedError", () => {
  it("names the missing piece", () => {
    expect(new NotImplementedError("X.y").message).toBe("X.y is not implemented yet");
  });
});
