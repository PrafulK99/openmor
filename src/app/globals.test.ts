// The page colors live in globals.css as variables. This reads them for both color schemes and checks the
// contrast of every text/background pair that matters, so a color edit cannot make text unreadable.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = vars(css.slice(0, darkStart));
const dark = { ...light, ...vars(css.slice(darkStart)) };

function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, string, string][] = [
  ["page text", "foreground", "background"],
  ["secondary text", "muted", "background"],
  ["link", "link", "background"],
  ["visited link", "link-visited", "background"],
  ["TEST CATALOG banner", "banner-fg", "banner-bg"],
  // Landing page.
  ["card text", "foreground", "surface"],
  ["card secondary text", "muted", "surface"],
  ["link in a card", "link", "surface"],
  ["accent text", "accent", "background"],
  ["accent text in a card", "accent", "surface"],
  ["primary button", "accent-fg", "accent"],
  ["code", "code-fg", "code-bg"],
  ["code comment", "code-muted", "code-bg"],
  ["code prompt", "code-accent", "code-bg"],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s color scheme", (_name, colors) => {
  it.each(PAIRS)("%s has a contrast ratio of at least 7:1", (_label, fg, bg) => {
    expect(colors[fg], fg).toBeDefined();
    expect(colors[bg], bg).toBeDefined();
    expect(contrast(colors[fg]!, colors[bg]!)).toBeGreaterThanOrEqual(7);
  });
});

it("defines a dark value for every color that differs between schemes, and the banner sets its own text color", () => {
  expect(dark["banner-bg"]).not.toBe(light["banner-bg"]);
  const views = readFileSync(new URL("./m/views.tsx", import.meta.url), "utf8");
  expect(views).toContain('color: "var(--banner-fg)"');
  expect(views).not.toMatch(/#[0-9a-f]{3,6}/i);
});
