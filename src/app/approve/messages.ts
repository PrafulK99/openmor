// What the buyer is told when an approval link cannot be used or a decision has been made.
// Fixed text keyed by a short code, so the result page can take its code from the URL safely.
import type { DecisionResult } from "@/core/buyer-links";

export interface Message {
  heading: string;
  body: string;
  /** Offer a way back to the approval page (the link is still pending). */
  retry?: boolean;
}

export const MESSAGES: Record<DecisionResult["kind"], Message> = {
  approved: {
    heading: "Approved",
    body: "Your assistant can now buy within the limits you saw. You can cancel this at any time by asking your assistant to revoke it.",
  },
  declined: {
    heading: "Declined",
    body: "Nothing was approved and nothing will be charged.",
  },
  no_saved_method: {
    heading: "Buy once with a normal checkout first, so a card is saved",
    body: "We could not find a saved card for you with this seller yet. Your approval is still waiting: after you have bought something once with a normal checkout, open the link in your email again and approve. That link works for 30 minutes after it was sent.",
    retry: true,
  },
  provider_unavailable: {
    heading: "Could not check for a saved card",
    body: "The payment provider did not answer. Nothing was approved. Try again in a minute.",
    retry: true,
  },
  invalid: {
    heading: "This link is not valid",
    body: "Check that you opened the whole link from the email. Ask your assistant to send a new one if you are unsure.",
  },
  expired: {
    heading: "This link has expired",
    body: "Approval links work for 30 minutes. Ask your assistant to send a new one.",
  },
  already_used: {
    heading: "This link was already used",
    body: "Each link works once. If you want to change what your assistant may do, ask it to send a new link.",
  },
};

export function messageFor(code: string | undefined): Message {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code as DecisionResult["kind"]] : MESSAGES.invalid;
}

/** Results after which the cookie holding the token is no longer needed. */
export function isFinal(kind: DecisionResult["kind"]): boolean {
  return kind !== "no_saved_method" && kind !== "provider_unavailable";
}
