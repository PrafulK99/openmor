// Sends email through Resend. The only module that imports the Resend SDK.
import { Resend } from "resend";
import type { EmailMessage, EmailSender } from "@/core/deps";
import { EmailSendError } from "@/core/errors";

/** Resend's shared test sender. It can only deliver to the Resend account's own address. */
export const DEFAULT_EMAIL_FROM = "OpenMoR <onboarding@resend.dev>";

/**
 * Resend never throws: failures come back as `{ error }`, including network problems (name
 * "application_error"). We turn any error into an EmailSendError that carries only Resend's
 * status code and error name. The error message is dropped on purpose: it can quote the
 * recipient's address.
 */
export function createEmailSender(options: { apiKey: string; from?: string }): EmailSender {
  const resend = new Resend(options.apiKey);
  const from = options.from?.trim() || DEFAULT_EMAIL_FROM;
  return {
    async send(message: EmailMessage, sendOptions?: { idempotencyKey?: string }): Promise<void> {
      const { error } = await resend.emails.send(
        { from, to: [message.to], subject: message.subject, text: message.text, html: message.html },
        sendOptions?.idempotencyKey ? { idempotencyKey: sendOptions.idempotencyKey } : undefined,
      );
      if (error) throw new EmailSendError(error.statusCode, error.name);
    },
  };
}

/** What stands in when RESEND_API_KEY is not set: every send fails with a clear config error. */
export const unconfiguredEmailSender: EmailSender = {
  async send(): Promise<void> {
    throw new Error("Email is not configured: set RESEND_API_KEY (see .env.example).");
  },
};
