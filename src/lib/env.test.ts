import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/openmor",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  APP_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("defaults DODO_ENVIRONMENT to test_mode", () => {
    expect(parseEnv(valid).DODO_ENVIRONMENT).toBe("test_mode");
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() =>
      parseEnv({ ...valid, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it("rejects an unknown Dodo environment", () => {
    expect(() => parseEnv({ ...valid, DODO_ENVIRONMENT: "prod" })).toThrow(/DODO_ENVIRONMENT/);
  });
});
