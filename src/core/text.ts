/** Max lengths for merchant-supplied text. It is data, so we cap it before it reaches agents. */
export const TEXT_LIMITS = {
  name: 200,
  description: 2000,
} as const;

/** Trim and cap a string at `max` characters (by code point, so emoji are not split). Empty becomes null. */
export function limitText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const chars = Array.from(trimmed);
  if (chars.length <= max) return trimmed;
  return chars.slice(0, max - 1).join("") + "…";
}
