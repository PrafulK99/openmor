// Copy for the landing page at /. Static: nothing here reads the database, env secrets or Dodo, so the
// home page cannot fail because of them. Every claim is checked against the code by src/app/home.test.tsx.
import type { Metadata } from "next";
import type { IconName } from "./icons";

export const REPO_URL = "https://github.com/PrafulK99/openmor";
export const PRODUCTION_URL = "https://openmor.vercel.app";
export const CONNECTOR_URL = `${PRODUCTION_URL}/api/mcp`;
export const MCP_ADD_COMMAND = `claude mcp add --transport http openmor ${CONNECTOR_URL}`;
export const SAMPLE_PROMPT = "Find a product in the sharethings test catalog and quote it for a buyer in Germany.";

const blob = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const DOCS = {
  readme: `${REPO_URL}#readme`,
  docs: `${REPO_URL}/tree/main/docs`,
  threatModel: blob("docs/threat-model.md"),
  security: blob("SECURITY.md"),
  license: blob("LICENSE"),
  savedPayments: blob("docs/dodo-saved-payments.md"),
} as const;

export const TITLE = "OpenMoR: let AI agents buy from merchant-of-record sellers";
export const DESCRIPTION =
  "Open-source layer that lets AI agents find, quote and buy digital products from merchants who sell through a merchant of record. The buyer always pays on the provider's hosted checkout.";

/** The canonical address of the home page, from APP_URL. Falls back to production if APP_URL is missing or not a web URL. */
export function homeUrl(appUrl: string | undefined): string {
  try {
    const url = new URL(appUrl ?? "");
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // Not a URL: use production.
  }
  return PRODUCTION_URL;
}

export function homeMetadata(appUrl: string | undefined): Metadata {
  const url = homeUrl(appUrl);
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: `${url}/` },
    openGraph: { type: "website", siteName: "OpenMoR", title: TITLE, description: DESCRIPTION, url: `${url}/` },
  };
}

/** Section ids, used by the in-page links. */
export const SECTION = {
  how: "how-it-works",
  tryIt: "try-it",
  doors: "front-doors",
  security: "security",
  limits: "limits",
} as const;

export const MCP_TOOL_NAMES = ["search_products", "get_product", "get_quote", "checkout", "get_order"] as const;
export const TEST_COUNT_FLOOR = 400;

/**
 * A real get_quote result from the live test catalog, taken on 2026-10-28 for a buyer in Germany. The
 * merchant is in Dodo test mode. Shown as an example: a new quote converts at that day's exchange rate.
 */
export const EXAMPLE_QUOTE = {
  takenOn: "2026-10-28",
  request: {
    merchant_id: "cmvig0yw80000x4vpzfa5oxr1",
    product_id: "cmvig1pe50001uwvpbom5gtbl",
    buyer_country: "DE",
  },
  productName: "[TEST] ShareThings Lifetime",
  listPrice: { amount_minor: 4900, currency: "USD", formatted: "$49.00" },
  response: {
    quote_id: "9bd4eec1-f945-4d74-8c82-878bae14d2f9",
    currency: "EUR",
    subtotal: { amount_minor: 4405, formatted: "€44.05" },
    tax: { amount_minor: 837, formatted: "€8.37" },
    total: { amount_minor: 5242, formatted: "€52.42" },
    tax_rate_percent: 19,
    is_converted: true,
    list_currency: "USD",
    is_binding: true,
    expires_in_seconds: 899,
  },
} as const;

export const STATS: { label: string; value: string; note: string }[] = [
  { label: "MCP tools", value: String(MCP_TOOL_NAMES.length), note: "registered" },
  { label: "Front doors", value: "4", note: "interfaces" },
  { label: "Licence", value: "Apache-2.0", note: "open source" },
  { label: "Automated tests", value: `${TEST_COUNT_FLOOR}+`, note: "in the repo" },
];

export interface Step {
  title: string;
  icon: IconName;
  body: string;
  tool: string;
}

export const STEPS: Step[] = [
  {
    title: "Find",
    icon: "search",
    body: "The agent searches the catalog across every listed merchant and gets each product's merchant_id and product_id.",
    tool: "search_products",
  },
  {
    title: "Quote with the right tax",
    icon: "percent",
    body: "A quote for the buyer's country, with tax, from Dodo's checkout preview. It is the price the agent should present, and it is valid for 15 minutes.",
    tool: "get_quote",
  },
  {
    title: "Pay on the hosted page",
    icon: "bag",
    body: "The agent sends the quote id and the buyer's email, never an amount, and gets a checkout link. The buyer sees the final price and pays on Dodo's page.",
    tool: "checkout",
  },
  {
    title: "Receive the licence key",
    icon: "key",
    body: "After a signed webhook confirms payment, the agent gets the licence key, read live from Dodo. It is returned only with the buyer's checkout email.",
    tool: "get_order",
  },
];

export interface FrontDoor {
  title: string;
  icon: IconName;
  body: string;
  links: { label: string; href: string }[];
}

export const FRONT_DOORS: FrontDoor[] = [
  {
    title: "MCP connector",
    icon: "terminal",
    body: `One URL for every merchant, with ${MCP_TOOL_NAMES.length} tools: ${MCP_TOOL_NAMES.join(", ")}. It takes tool calls over Streamable HTTP, not page views.`,
    links: [{ label: "Connect", href: `#${SECTION.tryIt}` }],
  },
  {
    title: "Readable pages and llms.txt",
    icon: "page",
    body: "Plain HTML pages for each merchant and product, with structured product data and list prices before tax, plus an llms.txt summary of the network.",
    links: [
      { label: "Merchant page", href: "/m/sharethings" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Markdown twins",
    icon: "markdown",
    body: "Every merchant and product page has a .md twin with the same facts as markdown, for agents that would rather read text than HTML.",
    links: [{ label: "Markdown twin", href: "/m/sharethings.md" }],
  },
  {
    title: "UCP read-only catalog",
    icon: "catalog",
    body: "A Universal Commerce Protocol profile with catalog search and lookup. It finds products only; buying goes through the MCP connector.",
    links: [{ label: "UCP profile", href: "/.well-known/ucp" }],
  },
];

export const SECURITY_CONTROLS: { title: string; icon: IconName; body: string }[] = [
  {
    title: "Encrypted merchant keys",
    icon: "lock",
    body: "Merchant Dodo API keys are stored only as AES-256-GCM ciphertext and are never returned by any API or tool.",
  },
  {
    title: "Verified webhooks",
    icon: "badge",
    body: "Every Dodo webhook signature is checked (Standard Webhooks) before anything in it is trusted. A bad signature gets a 401, and replays are deduplicated.",
  },
  {
    title: "Idempotent checkout",
    icon: "repeat",
    body: "The same quote and buyer email return the same order. A quote is marked used only after Dodo has created the checkout session.",
  },
  {
    title: "Test mode by default",
    icon: "flask",
    body: "Every merchant starts in Dodo test mode. Live mode needs an explicit per-merchant flag.",
  },
  {
    title: "IP rate limit on agent endpoints",
    icon: "gauge",
    body: "100 requests per IP per 60 seconds on the MCP connector and the UCP catalog, by a Vercel Firewall rule. Shared addresses share a counter.",
  },
  {
    title: "Merchant text is data",
    icon: "shield",
    body: "Product text is length-limited and returned as separate fields, never inside tool descriptions or links. Public pages also clean and escape it.",
  },
];

export const PROMPT_INJECTION_NOTE =
  "Limiting and cleaning merchant text reduces the risk of prompt injection; it cannot remove it. Agents must still treat product text as data, not instructions.";

export const CANT_DO_YET =
  "Today the buyer pays on Dodo's hosted page for every purchase, Dodo Payments is the only provider, and UCP is a read-only catalog with no checkout.";

export const ROADMAP: { title: string; body: string; status: string }[] = [
  {
    title: "Merchant dashboard",
    body: "Sign in, connect a Dodo key, choose products and opt in. Today merchants are onboarded by maintainer scripts.",
    status: "Maintainer scripts today",
  },
  {
    title: "More provider adapters",
    body: "More merchant-of-record providers behind the same adapter interface, so agents use the same tools whichever one a merchant sells through.",
    status: "Dodo Payments only today",
  },
  {
    title: "Repeat purchases",
    body: "An agent buying again without the buyer on a checkout page, once a provider exposes reusable saved payment methods for one-time purchases.",
    status: "Waiting on provider support",
  },
];
