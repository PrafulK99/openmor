// Guards for the Vercel setup described in docs/deploy.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const readJson = (file: string) => JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, unknown>;

describe("deploy config", () => {
  const vercel = readJson("vercel.json");
  const scripts = readJson("package.json").scripts as Record<string, string>;

  it("runs functions in Mumbai (bom1), next to the Supabase database", () => {
    expect(vercel.regions).toEqual(["bom1"]);
  });

  it("builds with prisma generate and never runs migrations", () => {
    expect(vercel.buildCommand).toBe("pnpm build");
    expect(scripts.build).toContain("prisma generate");
    for (const name of ["build", "postinstall"]) {
      expect(scripts[name]).not.toMatch(/migrate|db push/);
    }
    expect(String(vercel.installCommand)).not.toMatch(/migrate|db push/);
  });
});
