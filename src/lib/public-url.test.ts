import { describe, expect, it } from "vitest";
import { baseUrlFrom } from "@/lib/public-url";

describe("baseUrlFrom", () => {
  const appUrl = "https://openmor.example.com/";

  it("uses APP_URL, without a trailing slash, in production and locally", () => {
    expect(baseUrlFrom({ appUrl })).toBe("https://openmor.example.com");
    expect(baseUrlFrom({ appUrl, vercelEnv: "production", vercelUrl: "openmor-abc.vercel.app" })).toBe("https://openmor.example.com");
    expect(baseUrlFrom({ appUrl: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("uses the deployment's own address on a Vercel preview, so links point at the preview", () => {
    expect(baseUrlFrom({ appUrl, vercelEnv: "preview", vercelUrl: "openmor-git-feat-abc.vercel.app" })).toBe("https://openmor-git-feat-abc.vercel.app");
  });

  it("falls back to APP_URL on a preview that has no address", () => {
    expect(baseUrlFrom({ appUrl, vercelEnv: "preview" })).toBe("https://openmor.example.com");
  });
});
