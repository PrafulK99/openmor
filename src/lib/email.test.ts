import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailSendError } from "@/core/errors";
import { createEmailSender, DEFAULT_EMAIL_FROM, unconfiguredEmailSender } from "./email";

const resend = vi.hoisted(() => ({ send: vi.fn(), ctorKeys: [] as string[] }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resend.send };
    constructor(key: string) {
      resend.ctorKeys.push(key);
    }
  },
}));

const message = { to: "buyer@example.com", subject: "Hi", text: "plain", html: "<p>html</p>" };

beforeEach(() => {
  resend.send.mockReset();
  resend.ctorKeys.length = 0;
});

describe("createEmailSender", () => {
  it("sends through Resend with the sender, recipient list, both bodies and an idempotency key", async () => {
    resend.send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    await createEmailSender({ apiKey: "re_key" }).send(message, { idempotencyKey: "link/1" });
    expect(resend.ctorKeys).toEqual(["re_key"]);
    expect(resend.send).toHaveBeenCalledWith(
      { from: DEFAULT_EMAIL_FROM, to: ["buyer@example.com"], subject: "Hi", text: "plain", html: "<p>html</p>" },
      { idempotencyKey: "link/1" },
    );
  });

  it("uses a custom sender address and omits request options without an idempotency key", async () => {
    resend.send.mockResolvedValue({ data: { id: "em_1" }, error: null });
    await createEmailSender({ apiKey: "re_key", from: "OpenMoR <approvals@example.com>" }).send(message);
    expect(resend.send).toHaveBeenCalledWith(expect.objectContaining({ from: "OpenMoR <approvals@example.com>" }), undefined);
  });

  it("turns a Resend error into EmailSendError with status and name only, never the message", async () => {
    resend.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: "You can only send testing emails to owner@example.com" },
    });
    const err = await createEmailSender({ apiKey: "re_key" }).send(message).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ status: 403, errorName: "validation_error" });
    expect(JSON.stringify({ ...(err as object), message: (err as Error).message })).not.toContain("owner@example.com");
  });

  it("reports a network failure (Resend's application_error with no status) the same way", async () => {
    resend.send.mockResolvedValue({ data: null, error: { name: "application_error", statusCode: null, message: "fetch failed" } });
    await expect(createEmailSender({ apiKey: "re_key" }).send(message)).rejects.toMatchObject({ status: null, errorName: "application_error" });
  });
});

describe("unconfiguredEmailSender", () => {
  it("fails with a clear configuration error", async () => {
    await expect(unconfiguredEmailSender.send(message)).rejects.toThrow(/RESEND_API_KEY/);
  });
});
