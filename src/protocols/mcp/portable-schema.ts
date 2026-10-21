// Zod emits nullable fields as `type: ["string", "null"]`. That is valid JSON Schema, but some
// clients map tool schemas onto a single-`type` dialect (e.g. Gemini's OpenAPI subset) and drop
// or reject them. This wrapper keeps zod for validation and rewrites the advertised JSON Schema
// to use `anyOf` branches with one `type` each.
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";

type Json = Record<string, unknown>;

// Keywords that describe the field as a whole stay on the outer schema; the rest constrain the
// non-null branch (e.g. `minimum` belongs with `type: "number"`).
const ANNOTATIONS = new Set(["description", "title", "default", "examples", "deprecated", "readOnly", "writeOnly", "$comment"]);

export function typeArraysToAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(typeArraysToAnyOf);
  if (typeof node !== "object" || node === null) return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) out[key] = typeArraysToAnyOf(value);

  if (!Array.isArray(out.type)) return out;
  const types = out.type as string[];
  const outer: Json = {};
  const constraints: Json = {};
  for (const [key, value] of Object.entries(out)) {
    if (key === "type") continue;
    (ANNOTATIONS.has(key) ? outer : constraints)[key] = value;
  }
  outer.anyOf = types.map((t) => (t === "null" ? { type: "null" } : { type: t, ...constraints }));
  return outer;
}

/** Same validation as `schema`, but its advertised JSON Schema has no `type` arrays. */
export function portable<S extends z.ZodType>(schema: S): StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  const std = schema["~standard"] as unknown as StandardSchemaWithJSON<z.input<S>, z.output<S>>["~standard"];
  return {
    "~standard": {
      version: std.version,
      vendor: std.vendor,
      validate: std.validate,
      jsonSchema: {
        input: (options) => typeArraysToAnyOf(std.jsonSchema.input(options)) as Json,
        output: (options) => typeArraysToAnyOf(std.jsonSchema.output(options)) as Json,
      },
    },
  };
}
