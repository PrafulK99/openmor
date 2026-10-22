// The email that asks a buyer to approve an agent's spending permission.
import type { EmailMessage } from "@/core/deps";

/** Merchant names are data: strip anything that could break a header or a line. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface ApprovalEmailInput {
  to: string;
  merchantName: string;
  /** The terms in plain words, one line each (see describeTerms). */
  terms: string[];
  /** One-time link to the approval page. Contains the secret token: never log it. */
  approveUrl: string;
  /** How long the link works, in minutes. */
  validMinutes: number;
}

export function buildApprovalEmail(input: ApprovalEmailInput): EmailMessage {
  const merchant = oneLine(input.merchantName);
  const subject = `Approve your AI assistant's purchases from ${merchant}`.slice(0, 150);
  const intro = `An AI assistant asked for permission to buy from ${merchant} on your behalf. Approve only if that was you.`;
  const how = `Approve or decline here. The link works once and expires in ${input.validMinutes} minutes:`;
  const outro = "Nothing is charged unless you approve. If you did not expect this email, ignore it.";

  const text = [intro, "", ...input.terms.map((t) => `- ${t}`), "", how, input.approveUrl, "", outro].join("\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<ul>${input.terms.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`,
    `<p>${escapeHtml(how)}</p>`,
    `<p><a href="${escapeHtml(input.approveUrl)}">Review and approve</a></p>`,
    `<p style="color:#555">${escapeHtml(outro)}</p>`,
  ].join("\n");
  return { to: input.to, subject, text, html };
}
