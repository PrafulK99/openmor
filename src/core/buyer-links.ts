// Buyer links: a buyer's email-approved permission for an agent to charge their saved card at
// one merchant, within a monthly cap. Tokens are random and stored only as a SHA-256 hash.
import { createHash, randomBytes } from "node:crypto";
import { buildApprovalEmail } from "@/core/approval-email";
import { normalizeEmail, type CheckoutDeps } from "@/core/checkout";
import { nowFrom } from "@/core/deps";
import { DeadlineExceededError, raceDeadline } from "@/core/deadline";
import { EmailSendError, InvalidInputError, OpenMorError, ProviderError } from "@/core/errors";
import { formatMoney } from "@/core/money";

/** The emailed approval link works for this long. */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_LINK_DAYS = 30;
export const MAX_LINK_DAYS = 90;
const MAX_CAP_MINOR = 2_000_000_000;
const MAX_SCOPE_PRODUCTS = 20;
/** Approval emails to one address per hour, across all merchants. Stops agents from using us to spam. */
export const MAX_APPROVAL_EMAILS_PER_HOUR = 3;

export function hashApprovalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A 256-bit random token, URL-safe. Shown once (in the email) and never stored. */
export function newApprovalToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface Cap {
  /** Integer minor units (cents), e.g. 5000 = 50.00. */
  amountMinor: number;
  currency: string;
}

export interface CreateBuyerLinkInput {
  merchantId: string;
  buyerEmail: string;
  monthlyCap: Cap;
  perOrderCap?: Cap;
  /** OpenMoR product ids the link may buy. Omit for any agent-sellable product of the merchant. */
  productIds?: string[];
  /** How long the permission lasts. Default 30, at most 90. */
  expiresInDays?: number;
  agentSessionId?: string;
}

export interface CreatedBuyerLink {
  buyerLinkId: string;
  merchantId: string;
  buyerEmail: string;
  currency: string;
  monthlyCap: number;
  perOrderCap: number | null;
  productIds: string[] | null;
  /** When the permission ends. */
  expiresAt: Date;
  /** When the emailed approval link stops working. */
  approvalExpiresAt: Date;
}

/** What a buyer is agreeing to, in the words used in the email and on the approval page. */
export interface LinkTerms {
  merchantName: string;
  currency: string;
  monthlyCap: number;
  perOrderCap: number | null;
  /** Names of the products the link may buy. Null means anything the merchant sells to agents. */
  productNames: string[] | null;
  expiresAt: Date;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function describeTerms(t: LinkTerms): string[] {
  const m = (n: number) => formatMoney(n, t.currency);
  return [
    `Spending limit: up to ${m(t.monthlyCap)} each calendar month. It starts again on the 1st of each month (UTC).`,
    t.perOrderCap === null ? "Per purchase: no separate limit." : `Per purchase: nothing over ${m(t.perOrderCap)}.`,
    t.productNames === null
      ? `What it can buy: anything ${t.merchantName} sells to AI assistants.`
      : `What it can buy: only ${t.productNames.join(", ")}.`,
    `This permission ends on ${dayFormat.format(t.expiresAt)} (UTC). You can cancel it at any time by asking your assistant to revoke it.`,
  ];
}

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

function checkCap(name: string, cap: Cap): Cap {
  if (!Number.isInteger(cap.amountMinor) || cap.amountMinor < 1 || cap.amountMinor > MAX_CAP_MINOR) {
    throw new InvalidInputError(
      `${name}.amount must be a whole number of minor units (cents, paise) from 1 to ${MAX_CAP_MINOR}, e.g. 5000 for 50.00.`,
    );
  }
  const currency = cap.currency.trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw new InvalidInputError(`${name}.currency must be a 3-letter ISO 4217 currency code like EUR or USD.`);
  }
  return { amountMinor: cap.amountMinor, currency };
}

/**
 * Create a pending_approval link and email the buyer a one-time approval link (valid 30 minutes).
 * Nothing can be charged until the buyer approves. If the email cannot be sent the link is
 * removed again, so a failed call leaves nothing behind.
 */
export async function createBuyerLink(deps: CheckoutDeps, input: CreateBuyerLinkInput): Promise<CreatedBuyerLink> {
  const email = normalizeEmail(input.buyerEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new InvalidInputError("buyer_email must be a valid email address, e.g. buyer@example.com.");
  }
  const monthly = checkCap("monthly_cap", input.monthlyCap);
  const perOrder = input.perOrderCap ? checkCap("per_order_cap", input.perOrderCap) : null;
  if (perOrder && perOrder.currency !== monthly.currency) {
    throw new InvalidInputError("per_order_cap.currency must be the same as monthly_cap.currency.");
  }
  if (perOrder && perOrder.amountMinor > monthly.amountMinor) {
    throw new InvalidInputError("per_order_cap cannot be more than monthly_cap.");
  }
  const days = input.expiresInDays ?? DEFAULT_LINK_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_LINK_DAYS) {
    throw new InvalidInputError(`expires_in_days must be a whole number from 1 to ${MAX_LINK_DAYS}.`);
  }
  const productIds = input.productIds ? [...new Set(input.productIds.map((id) => id.trim()).filter(Boolean))] : [];
  if (input.productIds && (productIds.length === 0 || productIds.length > MAX_SCOPE_PRODUCTS)) {
    throw new InvalidInputError(`product_ids must list 1 to ${MAX_SCOPE_PRODUCTS} product ids, or be left out for any product.`);
  }

  const merchant = await deps.db.merchant.findUnique({
    where: { id: input.merchantId },
    select: { id: true, name: true, networkOptIn: true },
  });
  if (!merchant || !merchant.networkOptIn) {
    throw new OpenMorError("MERCHANT_NOT_FOUND", `No merchant "${input.merchantId}" in the network`);
  }

  let productNames: string[] | null = null;
  if (productIds.length) {
    const products = await deps.db.product.findMany({
      where: { id: { in: productIds }, merchantId: merchant.id, active: true, agentSellable: true },
      select: { id: true, name: true },
    });
    const unknown = productIds.filter((id) => !products.some((p) => p.id === id));
    if (unknown.length) {
      throw new InvalidInputError(`product_ids has products this merchant does not sell to agents: ${unknown.join(", ")}. Use product_id values from search_products.`);
    }
    productNames = productIds.map((id) => products.find((p) => p.id === id)!.name);
  }

  if (!deps.email) throw new Error("Email is not configured on this server");

  const now = nowFrom(deps);
  const recent = await deps.db.buyerLink.count({
    where: { buyerEmail: email, createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) } },
  });
  if (recent >= MAX_APPROVAL_EMAILS_PER_HOUR) {
    throw new InvalidInputError("Too many approval emails were sent to this address in the last hour. Ask the buyer to check their inbox, or try again later.");
  }

  const token = newApprovalToken();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const approvalExpiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
  const link = await deps.db.buyerLink.create({
    data: {
      merchantId: merchant.id,
      agentSessionId: input.agentSessionId ?? null,
      buyerEmail: email,
      status: "pending_approval",
      approvalTokenHash: hashApprovalToken(token),
      approvalExpiresAt,
      expiresAt,
      currency: monthly.currency,
      perOrderCapAmount: perOrder?.amountMinor ?? null,
      monthlyCapAmount: monthly.amountMinor,
      productScope: productIds,
    },
    select: { id: true },
  });

  const terms = describeTerms({
    merchantName: merchant.name,
    currency: monthly.currency,
    monthlyCap: monthly.amountMinor,
    perOrderCap: perOrder?.amountMinor ?? null,
    productNames,
    expiresAt,
  });
  const message = buildApprovalEmail({
    to: email,
    merchantName: merchant.name,
    terms,
    approveUrl: `${deps.appUrl.replace(/\/+$/, "")}/approve/${token}`,
    validMinutes: APPROVAL_TTL_MS / 60_000,
  });

  try {
    await raceDeadline(deps.email.send(message, { idempotencyKey: `buyer-link-approval/${link.id}` }));
  } catch (err) {
    await deps.db.buyerLink.delete({ where: { id: link.id } }).catch(() => undefined);
    if (err instanceof EmailSendError) {
      // Status and error name only: the message can quote the recipient's address.
      // eslint-disable-next-line no-console -- no address, token or message: status and error name only
      console.error("approval email failed", { status: err.status, error: err.errorName });
      throw new ProviderError("Email service", err.status ?? undefined, err.errorName, "The approval email could not be sent. Try again in a minute.");
    }
    if (err instanceof DeadlineExceededError) {
      throw new ProviderError("Email service", undefined, "deadline exceeded", "The approval email is slow to send. Try again in a minute.");
    }
    throw err;
  }

  return {
    buyerLinkId: link.id,
    merchantId: merchant.id,
    buyerEmail: email,
    currency: monthly.currency,
    monthlyCap: monthly.amountMinor,
    perOrderCap: perOrder?.amountMinor ?? null,
    productIds: productIds.length ? productIds : null,
    expiresAt,
    approvalExpiresAt,
  };
}
