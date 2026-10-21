import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portable, typeArraysToAnyOf } from "./portable-schema";
import { TOOLS } from "./server";

function typeArrays(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) return node.flatMap((n, i) => typeArrays(n, `${path}[${i}]`));
  if (typeof node !== "object" || node === null) return [];
  const here = Array.isArray((node as { type?: unknown }).type) ? [path] : [];
  return [...here, ...Object.entries(node).flatMap(([k, v]) => typeArrays(v, `${path}.${k}`))];
}

describe("typeArraysToAnyOf", () => {
  it("splits a nullable primitive into anyOf, keeping the description outside", () => {
    expect(typeArraysToAnyOf({ type: ["string", "null"], description: "d", maxLength: 5 })).toEqual({
      description: "d",
      anyOf: [{ type: "string", maxLength: 5 }, { type: "null" }],
    });
  });

  it("leaves single types alone", () => {
    expect(typeArraysToAnyOf({ type: "object", properties: { a: { type: "string" } } })).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
  });
});

describe("portable", () => {
  it("advertises no type arrays for any tool schema", () => {
    for (const tool of TOOLS) {
      for (const schema of [tool.inputSchema, tool.outputSchema]) {
        const json = portable(schema)["~standard"].jsonSchema.output({ target: "draft-2020-12" });
        expect(typeArrays(json), tool.name).toEqual([]);
      }
    }
  });

  it("uses anyOf for nullable output fields", () => {
    const json = portable(TOOLS.find((t) => t.name === "get_quote")!.outputSchema)["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    }) as { properties: Record<string, { anyOf?: unknown[] }> };
    expect(json.properties.buyer_state!.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
    expect(json.properties.tax_rate_percent!.anyOf).toEqual([{ type: "number" }, { type: "null" }]);
  });

  it("still validates with zod", async () => {
    const s = portable(z.object({ a: z.string().nullable() }));
    expect(await s["~standard"].validate({ a: null })).toEqual({ value: { a: null } });
    expect("issues" in (await s["~standard"].validate({ a: 1 }))).toBe(true);
  });
});
