// An EmailSender for tests that records every message instead of sending it.
import { vi } from "vitest";
import type { EmailMessage, EmailSender } from "@/core/deps";

export interface FakeEmail extends EmailSender {
  sent: EmailMessage[];
  send: ReturnType<typeof vi.fn<EmailSender["send"]>>;
}

export function fakeEmail(): FakeEmail {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: vi.fn<EmailSender["send"]>(async (message) => {
      sent.push(message);
    }),
  };
}

/** The approval token inside an email's link (the part after /approve/). */
export function tokenFromEmail(message: EmailMessage): string {
  const match = /\/approve\/([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error("no approval link in the email");
  return match[1]!;
}
