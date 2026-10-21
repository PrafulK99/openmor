/** Stable error codes. Agents and clients match on these strings, so never rename them. */
export const ERROR_CODES = [
  "QUOTE_EXPIRED",
  "PRICE_CHANGED",
  "PRODUCT_UNAVAILABLE",
  "LIMIT_EXCEEDED",
  "BUYER_NOT_LINKED",
  "PROVIDER_ERROR",
  "MERCHANT_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class OpenMorError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OpenMorError";
    this.code = code;
  }
}

/** A payment provider call failed. Carries the provider's HTTP status and message, never credentials. */
export class ProviderError extends OpenMorError {
  readonly provider: string;
  /** HTTP status from the provider, or undefined for network errors and timeouts. */
  readonly status: number | undefined;
  readonly providerMessage: string;

  constructor(provider: string, status: number | undefined, providerMessage: string) {
    const where = status === undefined ? "request failed" : `returned HTTP ${status}`;
    super("PROVIDER_ERROR", `${provider} ${where}: ${providerMessage}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.providerMessage = providerMessage;
  }
}

/** Bad caller input (e.g. a malformed slug). Not an agent-facing error code: protocol layers validate first. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

/** Thrown by adapter methods that exist in the interface but are not built yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}
