// The landing page. Fully static: it imports only its own copy, icons and copy button (./_home), and
// never reads the database or calls Dodo, so it renders even when both are down.
import Link from "next/link";
import {
  CANT_DO_YET,
  DOCS,
  EXAMPLE_QUOTE as Q,
  FRONT_DOORS,
  homeMetadata,
  MCP_ADD_COMMAND,
  MCP_TOOL_NAMES,
  PROMPT_INJECTION_NOTE,
  REPO_URL,
  ROADMAP,
  SAMPLE_PROMPT,
  SECTION,
  SECURITY_CONTROLS,
  STATS,
  STEPS,
} from "./_home/content";
import { CopyButton } from "./_home/copy-button";
import { Icon } from "./_home/icons";
import s from "./_home/home.module.css";

export const metadata = homeMetadata(process.env.APP_URL);

const cx = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");
const pad = (n: number) => String(n).padStart(2, "0");

/** How each front door is read: the format an agent gets back. */
const DOOR_FORMATS = ["Tool calls over Streamable HTTP", "HTML pages and plain text", "Markdown", "A JSON profile"] as const;

function ToolCall() {
  const r = Q.response;
  const str = (v: string) => <span className={s.string}>&quot;{v}&quot;</span>;
  return (
    <div className={s.call}>
      <p className={s.callHead}>
        <span>MCP tool call</span>
        <code className={s.callTool}>get_quote</code>
      </p>
      <pre className={s.code} aria-label="A get_quote call and its response, abridged" tabIndex={0}>
        <span className={s.prompt}>{"> "}</span>
        {"get_quote({\n"}
        {"    merchant_id: "}
        {str(Q.request.merchant_id)}
        {",\n    product_id: "}
        {str(Q.request.product_id)}
        {",\n    buyer_country: "}
        {str(Q.request.buyer_country)}
        {" })\n\n"}
        <span className={s.comment}>{"// response, abridged\n"}</span>
        {"  quote_id: "}
        {str(r.quote_id)}
        {"\n  currency: "}
        {str(r.currency)}
        {", total.formatted: "}
        {str(r.total.formatted)}
        {`\n  tax_rate_percent: ${r.tax_rate_percent}, is_binding: ${r.is_binding}`}
        {`\n  is_converted: ${r.is_converted}, list_currency: `}
        {str(r.list_currency)}
        {`\n  expires_in_seconds: ${r.expires_in_seconds}`}
      </pre>
    </div>
  );
}

function Quote() {
  const r = Q.response;
  return (
    <div className={s.quote} role="group" aria-label="Example quote">
      <div className={s.quoteSide}>
        <p className={s.quoteName}>{Q.productName}</p>
        <p className={s.quoteTag}>Example quote, test catalog</p>
        <p className={s.quoteMeta}>
          <span>
            Provider: <strong>Dodo Payments</strong>
          </span>
          <span>Test mode</span>
        </p>
      </div>
      <dl className={s.ledger}>
        <div className={s.ledgerRow}>
          <dt>List price ({Q.listPrice.currency})</dt>
          <dd>{Q.listPrice.formatted}</dd>
        </div>
        <div className={s.ledgerRow}>
          <dt>Subtotal ({r.currency})</dt>
          <dd>{r.subtotal.formatted}</dd>
        </div>
        <div className={s.ledgerRow}>
          <dt>VAT {r.tax_rate_percent}% (Germany)</dt>
          <dd>{r.tax.formatted}</dd>
        </div>
        <div className={cx(s.ledgerRow, s.ledgerTotal)}>
          <dt>Total</dt>
          <dd>{r.total.formatted}</dd>
        </div>
      </dl>
      <p className={s.quoteNote}>
        Amounts vary with exchange rates. The list price is in USD and this quote was converted to EUR (a real get_quote call, {Q.takenOn}). The buyer sees the final price on
        Dodo&apos;s page.
      </p>
    </div>
  );
}

export default function Home() {
  return (
    <div className={s.page}>
      <a className={s.skip} href="#main">
        Skip to content
      </a>

      <header className={s.nav}>
        <div className={cx(s.container, s.navInner)}>
          <div className={s.brand}>
            <Link className={s.wordmark} href="/" aria-label="OpenMoR home">
              <span className={s.logoDot} aria-hidden="true">
                <Icon name="coin" className={s.icon} />
              </span>
              <span>
                Open<b>MoR</b>
              </span>
            </Link>
            <p className={s.status}>Open source · test catalog</p>
          </div>
          <nav className={s.navLinks} aria-label="Sections">
            <a href={`#${SECTION.how}`}>How it works</a>
            <a href={`#${SECTION.tryIt}`}>Try it</a>
            <a href={DOCS.docs}>Docs</a>
            <a className={s.navCta} href={REPO_URL}>
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className={cx(s.container, s.hero)} aria-labelledby="hero-title">
          <div className={s.heroText}>
            <h1 id="hero-title" className={s.h1}>
              Let AI agents
              <br />
              buy your software.
            </h1>
            <p className={s.lede}>
              OpenMoR lets agents find your products, quote them with the right tax for the buyer&apos;s country, and hand the buyer a secure hosted checkout. Built first for
              merchants of record such as Dodo Payments.
            </p>
            <div className={s.actions}>
              <a className={cx(s.button, s.primary)} href={`#${SECTION.tryIt}`}>
                Try it
              </a>
              <a className={s.button} href={REPO_URL}>
                View on GitHub
              </a>
            </div>
            <ul className={s.margin} aria-label="Highlights">
              <li>
                <Icon name="shield" className={s.icon} />
                No card data touches OpenMoR
              </li>
              <li>
                <Icon name="terminal" className={s.icon} />
                {MCP_TOOL_NAMES.length} MCP tools
              </li>
              <li>
                <Icon name="page" className={s.icon} />
                Apache-2.0
              </li>
            </ul>
          </div>
          <div className={s.specimen}>
            <ToolCall />
            <Quote />
          </div>
        </section>

        <div className={s.notice} role="note">
          <p className={s.container}>
            <strong>The live catalog is a test catalog.</strong> Its merchant is in Dodo test mode, its products are marked [TEST], and no real purchases happen.
          </p>
        </div>

        <section className={cx(s.container, s.figures)} aria-label="OpenMoR in numbers">
          <dl className={s.figureRow}>
            {STATS.map((stat) => (
              <div key={stat.label} className={s.figure}>
                <dt>{stat.label}</dt>
                <dd>
                  <span className={cx(s.figureValue, /^\d/.test(stat.value) ? undefined : s.figureWord)}>{stat.value}</span>
                  <span className={s.figureNote}>{stat.note}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className={s.caption}>Counted from the code in the repository.</p>
        </section>

        <section id={SECTION.how} className={cx(s.container, s.section, s.how)} aria-labelledby="how-title">
          <div className={s.aside}>
            <h2 id="how-title" className={s.h2}>
              How a purchase works
            </h2>
            <p className={s.intro}>Four tool calls, in order. Each hands the agent what the next one needs.</p>
          </div>
          <ol className={s.steps}>
            {STEPS.map((step) => (
              <li key={step.title} className={s.step}>
                <h3 className={s.h3}>{step.title}</h3>
                <p className={s.stepBody}>{step.body}</p>
                <p className={s.stepCall}>
                  <code>{step.tool}</code>
                  <span>returns {step.returns}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section id={SECTION.tryIt} className={s.band} aria-labelledby="try-title">
          <div className={cx(s.container, s.tryInner)}>
            <div className={s.tryHead}>
              <h2 id="try-title" className={s.h2}>
                Try it
              </h2>
              <p className={s.intro}>Add the connector to Claude Code, then ask for a quote. Any MCP client that supports Streamable HTTP can use the same URL.</p>
            </div>
            <div className={s.tryBody}>
              <div className={s.command}>
                <div className={s.commandHead}>
                  <span>Claude Code, add the MCP connector</span>
                  <CopyButton text={MCP_ADD_COMMAND} label="Copy the command" />
                </div>
                <pre className={s.commandCode} aria-label="The command to add the connector" tabIndex={0}>
                  <span className={s.prompt}>{"$ "}</span>
                  <code>{MCP_ADD_COMMAND}</code>
                </pre>
              </div>
              <figure className={s.ask}>
                <figcaption>Sample agent prompt:</figcaption>
                <blockquote className={s.askText}>
                  <p>{SAMPLE_PROMPT}</p>
                </blockquote>
                <p className={s.askNote}>
                  It calls <code>search_products</code>, then <code>get_quote</code>
                </p>
              </figure>
            </div>
          </div>
        </section>

        <section id={SECTION.doors} className={cx(s.container, s.section, s.doorsSection)} aria-labelledby="doors-title">
          <div className={s.split}>
            <h2 id="doors-title" className={s.h2}>
              Four front doors
            </h2>
            <p className={s.intro}>Every listed merchant is reachable the way an agent prefers to read.</p>
          </div>
          <ul className={s.doors}>
            {FRONT_DOORS.map((door, i) => (
              <li key={door.title} className={s.door}>
                <p className={s.doorLabel}>Door {pad(i + 1)}</p>
                <h3 className={s.h3}>{door.title}</h3>
                <p className={s.doorBody}>{door.body}</p>
                <p className={s.doorFormat}>{DOOR_FORMATS[i]}</p>
                <p className={s.doorLinks}>
                  {door.links.map((link) => (
                    <a key={link.href} href={link.href}>
                      {link.label}
                    </a>
                  ))}
                </p>
              </li>
            ))}
          </ul>
          <p className={s.core}>All four are served by one core and one catalog.</p>
        </section>

        <section id={SECTION.security} className={cx(s.container, s.section, s.security)} aria-labelledby="security-title">
          <div className={s.aside}>
            <h2 id="security-title" className={s.h2}>
              Security
            </h2>
            <p className={s.intro}>Buyers pay on Dodo&apos;s hosted checkout every time, so no card details pass through OpenMoR. The threat model lists where each control lives.</p>
            <p className={s.links}>
              <a href={DOCS.threatModel}>Threat model</a>
              <a href={DOCS.security}>SECURITY.md</a>
            </p>
          </div>
          <div className={s.securityBody}>
            <ul className={s.controls}>
              {SECURITY_CONTROLS.map((control) => (
                <li key={control.title} className={s.control}>
                  <h3 className={s.h4}>
                    <Icon name={control.icon} className={s.icon} />
                    {control.title}
                  </h3>
                  <p>{control.body}</p>
                </li>
              ))}
            </ul>
            <p className={s.warning}>
              <strong>Prompt injection.</strong> {PROMPT_INJECTION_NOTE}
            </p>
          </div>
        </section>

        <section id={SECTION.limits} className={cx(s.container, s.section, s.limits)} aria-labelledby="limits-title">
          <div className={s.split}>
            <h2 id="limits-title" className={s.h2}>
              What it can&apos;t do yet
            </h2>
            <p className={s.intro}>{CANT_DO_YET}</p>
          </div>
          <table className={s.roadmap}>
            <caption>Roadmap, no dates</caption>
            <thead>
              <tr>
                <th scope="col">Next</th>
                <th scope="col">What it means</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {ROADMAP.map((item) => (
                <tr key={item.title}>
                  <th scope="row" className={s.roadmapTitle}>
                    <h3 className={s.h3}>{item.title}</h3>
                  </th>
                  <td>{item.body}</td>
                  <td className={s.roadmapStatus}>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.links}>
            <a href={DOCS.savedPayments}>Why repeat purchases are blocked</a>
          </p>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={cx(s.container, s.footerInner)}>
          <div className={s.footerMark}>
            <p className={s.footerWord}>
              Open<b>MoR</b>
            </p>
            <p>© 2026 Praful Kharpuriye</p>
          </div>
          <ul className={s.footerLinks} aria-label="Project links">
            <li>
              <a href={REPO_URL}>GitHub</a>
            </li>
            <li>
              <a href={DOCS.readme}>README</a>
            </li>
            <li>
              <a href={DOCS.docs}>Docs</a>
            </li>
            <li>
              <a href={DOCS.license}>Apache-2.0</a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
