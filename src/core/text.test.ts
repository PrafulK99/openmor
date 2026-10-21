import { describe, expect, it } from "vitest";
import { limitText } from "@/core/text";

describe("limitText", () => {
  it("trims and keeps short text", () => {
    expect(limitText("  hi  ", 10)).toBe("hi");
  });

  it("turns empty or missing text into null", () => {
    expect(limitText("   ", 10)).toBeNull();
    expect(limitText(null, 10)).toBeNull();
    expect(limitText(undefined, 10)).toBeNull();
  });

  it("caps long text with an ellipsis, without splitting emoji", () => {
    expect(limitText("abcdef", 4)).toBe("abc…");
    expect(Array.from(limitText("😀".repeat(10), 4)!)).toEqual(["😀", "😀", "😀", "…"]);
  });
});
