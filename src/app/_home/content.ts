// Copy for the landing page at /. Static: nothing here reads the database, env secrets or Dodo, so the
// home page cannot fail because of them. Every claim is checked against the code by src/app/home.test.tsx.
import type { Metadata } from "next";

export const REPO_URL = "https://github.com/PrafulK99/openmor";
export const AUTHOR_URL = "https://github.com/PrafulK99";
export const PRODUCTION_URL = "https://openmor.vercel.app";
export const CONNECTOR_URL = `${PRODUCTION_URL}/api/mcp`;
export const MCP_ADD_COMMAND = `claude mcp add --transport http openmor ${CONNECTOR_URL}`;
export const SAMPLE_PROMPT =
  "Use OpenMoR to find a product in the sharethings test catalog, quote it for a buyer in Germany, and give me a checkout link for buyer@example.com.";

const blob = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const DOCS = {
  readme: `${REPO_URL}#readme`,
  docs: `${REPO_URL}/tree/main/docs`,
  threatModel: blob("docs/threat-model.md"),
  security: blob("SECURITY.md"),
  license: blob("LICENSE"),
  savedPayments: blob("docs/dodo-saved-payments.md"),
  ucp: blob("docs/ucp-acp.md"),
  publicPages: blob("docs/public-pages.md"),
} as const;

export const TITLE = "OpenMoR: let AI agents buy from merchant-of-record sellers";
export const DESCRIPTION =
  "Open-source layer that lets AI agents discover, quote and buy digital products from merchants who sell through a merchant of record. The buyer always pays on the provider's hosted checkout.";

/** The canonical address of the home page, from APP_URL. Falls back to production if APP_URL is missing or not a URL. */
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

/** Section ids, used for the in-page links. */
export const SECTION = {
  how: "how-it-works",
  tryIt: "try-it",
  doors: "front-doors",
  security: "security",
  limits: "limits",
} as const;

export interface Stat {
  value: string;
  label: string;
}

/** Every number here is checked by a test: the tool count, the door count, the quote lifetime and the test count. */
export const MCP_TOOL_NAMES = ["search_products", "get_product", "get_quote", "checkout", "get_order"] as const;
export const QUOTE_MINUTES = 15;
export const TEST_COUNT_FLOOR = 400;

export interface Step {
  title: string;
  tools: string[];
  body: string;
}

export const STEPS: Step[] = [
  {
    title: "Find",
    tools: ["search_products", "get_product"],
    body: "The agent searches products across every listed merchant and reads the details: price, billing, and what the buyer receives.",
  },
  {
    title: "Quote with the right tax",
    tools: ["get_quote"],
    body: `A quote for the buyer's country, with tax, from Dodo's own checkout preview, not a guess. It is valid for ${QUOTE_MINUTES} minutes.`,
  },
  {
    title: "Pay on Dodo's hosted page",
    tools: ["checkout"],
    body: "The agent sends the quote id and the buyer's email, never an amount, and gets a checkout link. The buyer pays on Dodo's page. No card details touch OpenMoR.",
  },
  {
    title: "Receive the licence key",
    tools: ["get_order"],
    body: "Once a signed webhook confirms payment, the agent gets the licence key, read live from Dodo. It is only returned with the buyer's checkout email.",
  },
];

export interface FrontDoor {
  title: string;
  body: string;
  links: { label: string; href: string }[];
}

export const FRONT_DOORS: FrontDoor[] = [
  {
    title: "MCP connector",
    body: `One URL for every merchant, with ${MCP_TOOL_NAMES.length} tools: ${MCP_TOOL_NAMES.join(", ")}. It speaks Streamable HTTP, so it accepts tool calls, not page views.`,
    links: [{ label: "Connect an agent", href: `#${SECTION.tryIt}` }],
  },
  {
    title: "Readable pages and llms.txt",
    body: "Plain HTML pages for each merchant and product, with structured product data, list prices before tax, and an llms.txt summary of the network.",
    links: [
      { label: "Merchant page", href: "/m/sharethings" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Markdown twins",
    body: "Every merchant and product page has a .md twin: the same facts as markdown, for agents that would rather read text than HTML.",
    links: [{ label: "Markdown twin", href: "/m/sharethings.md" }],
  },
  {
    title: "UCP read-only catalog",
    body: "A Universal Commerce Protocol profile with catalog search and lookup. It finds products; buying still goes through the connector.",
    links: [{ label: "UCP profile", href: "/.well-known/ucp" }],
  },
];

export const STATS: Stat[] = [
  { value: String(MCP_TOOL_NAMES.length), label: "MCP tools" },
  { value: String(FRONT_DOORS.length), label: "front doors for agents" },
  { value: `${QUOTE_MINUTES} min`, label: "quote lifetime, tax included" },
  { value: `${TEST_COUNT_FLOOR}+`, label: "automated tests" },
];

export const SECURITY_CONTROLS: { title: string; body: string }[] = [
  { title: "No card data", body: "Buyers pay on Dodo's hosted checkout page every time. Card details never pass through OpenMoR." },
  { title: "Keys encrypted at rest", body: "Merchant Dodo API keys are stored with AES-256-GCM and never returned by any API or tool." },
  { title: "Verified webhooks", body: "Every Dodo webhook signature is checked (Standard Webhooks) before anything in it is trusted. A bad signature gets a 401." },
  { title: "Agents never send amounts", body: "Checkout takes a quote id. It is idempotent, and a quote is marked used only after Dodo has created the checkout session." },
  { title: "Test mode by default", body: "Live mode needs an explicit per-merchant flag." },
  { title: "Rate limited at the edge", body: "100 requests per IP per 60 seconds on the connector and the UCP catalog, by a Vercel Firewall rule." },
  { title: "Merchant text is data", body: "Product names and descriptions are length-limited, escaped, and never placed in links or instructions." },
  { title: "Strict headers", body: "A Content-Security-Policy and other security headers are set on every route." },
];

export const LIMITS: string[] = [
  "The buyer pays on Dodo's hosted page every time. Agent-initiated repeat purchases are blocked: Dodo does not yet expose a reusable saved payment method for one-time checkouts.",
  "UCP is a read-only catalog: search and lookup only, with no UCP checkout, order or payment handler. The ACP product feed is deferred.",
  "Merchants are onboarded by maintainer scripts. There is no merchant dashboard yet.",
  "Dodo Payments is the only provider so far.",
];

export const ROADMAP: string[] = [
  "A merchant dashboard: sign in, connect a Dodo key, choose products, opt in.",
  "More provider adapters.",
  "Agent-initiated repeat purchases, only if a provider exposes reusable saved methods.",
];
