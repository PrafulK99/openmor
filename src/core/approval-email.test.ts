import { describe, expect, it } from "vitest";
import { buildApprovalEmail, escapeHtml } from "./approval-email";

const base = {
  to: "buyer@example.com",
  merchantName: "ShareThings",
  terms: ["Spending limit: up to €50.00 each calendar month.", "Per purchase: nothing over €20.00."],
  approveUrl: "https://openmor.example.com/approve/tok_abc-123_XYZ",
  validMinutes: 30,
};

describe("buildApprovalEmail", () => {
  it("names the merchant, lists the terms, and gives the link and its lifetime in plain text and HTML", () => {
    const m = buildApprovalEmail(base);
    expect(m.to).toBe("buyer@example.com");
    expect(m.subject).toBe("Approve your AI assistant's purchases from ShareThings");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("ShareThings");
      expect(body).toContain("Spending limit: up to €50.00 each calendar month.");
      expect(body).toContain("expires in 30 minutes");
    }
    expect(m.text).toContain("https://openmor.example.com/approve/tok_abc-123_XYZ");
    expect(m.html).toContain('href="https://openmor.example.com/approve/tok_abc-123_XYZ"');
    expect(m.text).toContain("Nothing is charged unless you approve");
  });

  it("escapes merchant-supplied text in HTML", () => {
    const m = buildApprovalEmail({ ...base, merchantName: `<img src=x onerror=alert(1)> & "Co"`, terms: ["Only <b>this</b>"] });
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<b>");
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;");
  });

  it("keeps line breaks and control characters out of the subject", () => {
    const m = buildApprovalEmail({ ...base, merchantName: "Evil\r\nBcc: attacker@example.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toContain("Evil Bcc: attacker@example.com");
  });

  it("caps the subject length", () => {
    expect(buildApprovalEmail({ ...base, merchantName: "x".repeat(500) }).subject.length).toBeLessThanOrEqual(150);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
