import { describe, expect, it } from "vitest";
import { currencyDigits, formatMoney } from "@/core/money";

describe("currencyDigits", () => {
  it("knows minor-unit digits per currency", () => {
    expect(currencyDigits("USD")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(currencyDigits("KWD")).toBe(3);
  });
});

describe("formatMoney", () => {
  it("formats minor units as money", () => {
    expect(formatMoney(5191, "EUR")).toBe("€51.91");
    expect(formatMoney(104254, "INR")).toBe("₹1,042.54");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatMoney(19.99, "USD")).toThrow(TypeError);
  });
});
