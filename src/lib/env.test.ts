import { describe, expect, it } from "vitest";
import { assertProductionEnv, parseEnv, productionEnvProblems } from "@/lib/env";

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

  it("accepts only true or false for PUBLIC_INCLUDE_TEST_MERCHANTS, and leaves it unset by default", () => {
    expect(parseEnv(valid).PUBLIC_INCLUDE_TEST_MERCHANTS).toBeUndefined();
    expect(parseEnv({ ...valid, PUBLIC_INCLUDE_TEST_MERCHANTS: "true" }).PUBLIC_INCLUDE_TEST_MERCHANTS).toBe("true");
    expect(() => parseEnv({ ...valid, PUBLIC_INCLUDE_TEST_MERCHANTS: "yes" })).toThrow(/PUBLIC_INCLUDE_TEST_MERCHANTS/);
  });

  it("rejects an unknown Dodo environment", () => {
    expect(() => parseEnv({ ...valid, DODO_ENVIRONMENT: "prod" })).toThrow(/DODO_ENVIRONMENT/);
  });
});

describe("productionEnvProblems / assertProductionEnv", () => {
  const prod = { ...valid, NODE_ENV: "production", APP_URL: "https://openmor.example.com" };

  it("accepts a complete production config", () => {
    expect(productionEnvProblems(prod)).toEqual([]);
    expect(() => assertProductionEnv(prod)).not.toThrow();
  });

  it("checks nothing outside production", () => {
    expect(productionEnvProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: "test" })).toEqual([]);
  });

  it.each(["DATABASE_URL", "ENCRYPTION_KEY", "APP_URL"])("reports a missing or blank %s", (name) => {
    expect(productionEnvProblems({ ...prod, [name]: undefined })).toContain(`${name} is not set`);
    expect(productionEnvProblems({ ...prod, [name]: "  " })).toContain(`${name} is not set`);
  });

  it("lists every missing variable at once", () => {
    expect(productionEnvProblems({ NODE_ENV: "production" })).toEqual([
      "DATABASE_URL is not set",
      "ENCRYPTION_KEY is not set",
      "APP_URL is not set",
    ]);
  });

  it("requires an https APP_URL", () => {
    expect(productionEnvProblems({ ...prod, APP_URL: "http://openmor.example.com" })).toEqual([
      "APP_URL must start with https:// in production",
    ]);
    expect(productionEnvProblems({ ...prod, APP_URL: "openmor.example.com" })).toEqual(["APP_URL is not a valid URL"]);
  });

  it("reports a malformed encryption key without echoing it", () => {
    const key = Buffer.alloc(16, 7).toString("base64");
    const problems = productionEnvProblems({ ...prod, ENCRYPTION_KEY: key });
    expect(problems).toEqual(["ENCRYPTION_KEY: ENCRYPTION_KEY must be 32 bytes, base64-encoded"]);
  });

  it("throws one clear message that never contains secret values", () => {
    const secretDb = "postgresql://user:SUPERSECRET@db.example.com:5432/x";
    const err = (() => {
      try {
        assertProductionEnv({ NODE_ENV: "production", DATABASE_URL: secretDb, APP_URL: "http://x.example.com" });
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected a throw");
    })();
    expect(err.message).toContain("OpenMoR cannot start");
    expect(err.message).toContain("ENCRYPTION_KEY is not set");
    expect(err.message).toContain("APP_URL must start with https://");
    expect(err.message).not.toContain("SUPERSECRET");
  });
});
