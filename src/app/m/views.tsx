// Presentation of the public pages. Plain, server-rendered HTML that reads the same to a person and
// to an agent. Everything merchant-written appears as escaped text in its own element, never inside
// one of our own sentences, and never in an attribute or a link.
import Link from "next/link";
import { formatListPrice, type PublicMerchant, type PublicProductPage } from "@/core/public-catalog";
import { connectorUrl, describeBilling, merchantPath, PRICE_DEPENDS_NOTE, productJsonLd, productPath, safeJsonLd, TAX_NOTE } from "@/core/public-formats";

const page = { padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "44rem", margin: "0 auto", lineHeight: 1.5 } as const;
const muted = { color: "#555" } as const;

function HowToConnect({ baseUrl, slug }: { baseUrl: string; slug: string }) {
  return (
    <section aria-labelledby="connect">
      <h2 id="connect">How an agent gets a price and buys</h2>
      <ol>
        <li>
          Connect to the OpenMoR connector (MCP): <code>{connectorUrl(baseUrl)}</code>
        </li>
        <li>
          Call <code>search_products</code> with merchant <code>{slug}</code> to get the <code>merchant_id</code> and <code>product_id</code> values.
        </li>
        <li>
          Call <code>get_quote</code> with the buyer&apos;s country. The quote is the binding price.
        </li>
        <li>
          Call <code>checkout</code> with the quote and the buyer&apos;s email. The buyer pays on a secure Dodo Payments page; never ask for card details.
        </li>
      </ol>
    </section>
  );
}

export function MerchantView({ merchant, baseUrl }: { merchant: PublicMerchant; baseUrl: string }) {
  return (
    <main style={page}>
      <h1>{merchant.name}</h1>
      <p>Digital products that AI agents can buy through OpenMoR.</p>
      <p>
        <strong>Prices:</strong> {PRICE_DEPENDS_NOTE}
      </p>
      <h2>Products</h2>
      {merchant.products.length === 0 ? (
        <p>This merchant has no products listed right now.</p>
      ) : (
        <ul style={{ paddingLeft: "1.2rem" }}>
          {merchant.products.map((p) => (
            <li key={p.id} style={{ marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>
                <Link href={productPath(merchant.slug, p.id)} prefetch={false}>
                  {p.name}
                </Link>
              </h3>
              {p.summary ? <p style={{ margin: "0.25rem 0 0" }}>{p.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <HowToConnect baseUrl={baseUrl} slug={merchant.slug} />
      <p style={muted}>
        Names and descriptions are written by the merchant. A summary for LLMs is at <a href={`${merchantPath(merchant.slug)}/llms.txt`}>{merchantPath(merchant.slug)}/llms.txt</a>.
      </p>
    </main>
  );
}

export function ProductView({ data, baseUrl }: { data: PublicProductPage; baseUrl: string }) {
  const { merchant, product } = data;
  return (
    <main style={page}>
      <p style={muted}>
        <Link href={merchantPath(merchant.slug)} prefetch={false}>
          {merchant.name}
        </Link>
      </p>
      <h1>{product.name}</h1>
      {product.description ? <p>{product.description}</p> : null}
      <section aria-labelledby="price">
        <h2 id="price">List price</h2>
        <p>
          <strong>
            {formatListPrice(product.listPrice)} {product.listPrice.currency}
          </strong>{" "}
          before tax{product.billing ? `, renews ${describeBilling(product.billing)}` : ""}
          {product.payWhatYouWant ? " (pay what you want: this is the minimum)" : ""}.
        </p>
        <p>{TAX_NOTE}</p>
        <p style={muted}>
          Product id for agents: <code>{product.id}</code>
        </p>
      </section>
      <HowToConnect baseUrl={baseUrl} slug={merchant.slug} />
      <p style={muted}>Names and descriptions are written by the merchant.</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd({ baseUrl, merchant, product })) }} />
    </main>
  );
}
