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

function Kicker({ children }: { children: string }) {
  return <p className={s.kicker}>{children}</p>;
}

function HeroTerminal() {
  const r = Q.response;
  const str = (v: string) => <span className={s.string}>&quot;{v}&quot;</span>;
  return (
    <>
      <div className={s.termBar}>
        <span className={s.termTitle}>
          <span className={s.lights} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={s.termHint}>MCP tool call</span>
        </span>
        <span className={s.termTag}>get_quote</span>
      </div>
      <pre className={s.code} aria-label="A get_quote call and its response, abridged">
        <span className={s.prompt}>{"> "}</span>
        {"get_quote({\n"}
        {"    merchant_id: "}
        {str(Q.request.merchant_id)}
        {",\n    product_id: "}
        {str(Q.request.product_id)}
        {",\n    buyer_country: "}
        {str(Q.request.buyer_country)}
        {"\n  })\n\n"}
        <span className={s.comment}>{"// response, abridged\n"}</span>
        {"  quote_id: "}
        {str(r.quote_id)}
        {"\n  currency: "}
        {str(r.currency)}
        {"\n  total.formatted: "}
        {str(r.total.formatted)}
        {`\n  tax_rate_percent: ${r.tax_rate_percent}`}
        {`\n  is_converted: ${r.is_converted}`}
        {"\n  list_currency: "}
        {str(r.list_currency)}
        {`\n  is_binding: ${r.is_binding}`}
        {`\n  expires_in_seconds: ${r.expires_in_seconds}`}
      </pre>
    </>
  );
}

function QuoteCard() {
  const r = Q.response;
  return (
    <div className={s.receipt} role="group" aria-label="Example quote">
      <div className={s.receiptHead}>
        <span className={s.receiptTag}>Example quote, test catalog</span>
        <p className={s.receiptName}>{Q.productName}</p>
      </div>
      <dl className={s.receiptLines}>
        <div className={s.line}>
          <dt>List price ({Q.listPrice.currency})</dt>
          <dd>{Q.listPrice.formatted}</dd>
        </div>
        <div className={s.line}>
          <dt>Subtotal ({r.currency})</dt>
          <dd>{r.subtotal.formatted}</dd>
        </div>
        <div className={s.line}>
          <dt>VAT {r.tax_rate_percent}% (Germany)</dt>
          <dd>{r.tax.formatted}</dd>
        </div>
        <div className={cx(s.line, s.totalLine)}>
          <dt>Total</dt>
          <dd>{r.total.formatted}</dd>
        </div>
      </dl>
      <div className={s.receiptFoot}>
        <span className={s.mor}>
          <Icon name="badge" className={s.icon} />
          <span>
            Provider: <strong>Dodo Payments</strong>
          </span>
        </span>
        <span className={s.pill}>Test mode</span>
      </div>
      <p className={s.receiptNote}>
        Amounts vary with exchange rates. The list price is in USD and this quote was converted to EUR, from a real get_quote call on {Q.takenOn}. The buyer sees the final price
        on Dodo&apos;s hosted checkout.
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

      <div className={s.navShell}>
        <header className={s.navbar}>
          <Link className={s.wordmark} href="/" aria-label="OpenMoR home">
            <span className={s.logoDot} aria-hidden="true">
              <Icon name="coin" className={s.icon} />
            </span>
            <span>
              Open<b>MoR</b>
            </span>
          </Link>
          <nav className={s.navLinks} aria-label="Sections">
            <a href={`#${SECTION.how}`}>How it works</a>
            <a href={`#${SECTION.tryIt}`}>Try it</a>
            <a href={DOCS.docs}>Docs</a>
          </nav>
          <a className={s.navCta} href={REPO_URL}>
            GitHub
            <Icon name="external" className={s.icon} />
          </a>
        </header>
      </div>

      <main id="main" className={s.wrap}>
        <section className={s.hero} aria-labelledby="hero-title">
          <div>
            <p className={s.badge}>
              <span className={s.dot} aria-hidden="true" />
              Open source · test catalog
            </p>
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
                <Icon name="terminal" className={s.icon} />
                View on GitHub
              </a>
            </div>
            <ul className={s.chips} aria-label="Highlights">
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
          <div className={s.heroCard}>
            <HeroTerminal />
            <QuoteCard />
          </div>
        </section>

        <div className={s.notice} role="note">
          <p>
            <span className={s.noticeIcon}>
              <Icon name="info" className={s.icon} />
            </span>
            <span>
              <strong>The live catalog is a test catalog.</strong> Its merchant is in Dodo test mode, its products are marked [TEST], and no real purchases happen.
            </span>
          </p>
          <span className={s.pill}>Test mode</span>
        </div>

        <section aria-label="OpenMoR in numbers">
          <dl className={s.stats}>
            {STATS.map((stat) => (
              <div key={stat.label} className={s.stat}>
                <dt>{stat.label}</dt>
                <dd>
                  <span className={cx(s.statValue, /^\d/.test(stat.value) ? undefined : s.statWord)}>{stat.value}</span>
                  <span className={s.statNote}>{stat.note}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className={s.statsFoot}>Counted from the code in the repository.</p>
        </section>

        <section id={SECTION.how} className={s.section} aria-labelledby="how-title">
          <div className={s.sectionHead}>
            <Kicker>Four tool calls</Kicker>
            <h2 id="how-title" className={s.h2}>
              How a purchase works
            </h2>
          </div>
          <ol className={s.grid}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={s.card}>
                <div className={s.cardTop}>
                  <span className={s.stepChip}>STEP // {pad(i + 1)}</span>
                  <span className={s.iconBubble}>
                    <Icon name={step.icon} className={s.icon} />
                  </span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <div className={cx(s.cardFoot, s.cardFootRule)}>
                  <code className={s.toolName}>{step.tool}</code>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id={SECTION.tryIt} className={s.section} aria-labelledby="try-title">
          <div className={s.sectionHead}>
            <Kicker>Connect an agent</Kicker>
            <h2 id="try-title" className={s.h2}>
              Try it
            </h2>
            <p className={s.intro}>Add the connector to Claude Code, then ask for a quote. Any MCP client that supports Streamable HTTP can use the same URL.</p>
          </div>
          <div className={s.tryWindow}>
            <div className={s.tryBar}>
              <span>
                <span className={s.termTag}>CLAUDE CODE</span> / add the MCP connector
              </span>
              <CopyButton text={MCP_ADD_COMMAND} label="Copy the command" />
            </div>
            <pre className={s.tryCode}>
              <span className={s.prompt}>{"$ "}</span>
              <code>{MCP_ADD_COMMAND}</code>
            </pre>
            <div className={s.tryPrompt}>
              <div className={s.tryPromptMain}>
                <span className={s.promptLabel}>Sample agent prompt:</span>
                <p className={s.promptText}>{SAMPLE_PROMPT}</p>
              </div>
              <p className={s.tryNote}>
                It calls <code>search_products</code>, then <code>get_quote</code>
              </p>
            </div>
          </div>
        </section>

        <section id={SECTION.doors} className={s.section} aria-labelledby="doors-title">
          <div className={s.sectionHead}>
            <Kicker>One core, four ways in</Kicker>
            <h2 id="doors-title" className={s.h2}>
              Four front doors
            </h2>
            <p className={s.intro}>Every listed merchant is reachable the way an agent prefers to read. All four are served by one core and one catalog.</p>
          </div>
          <ul className={s.grid}>
            {FRONT_DOORS.map((door, i) => (
              <li key={door.title} className={s.card}>
                <div className={s.cardTop}>
                  <span className={s.cardLabel}>Door {pad(i + 1)}</span>
                  <span className={s.iconBubble}>
                    <Icon name={door.icon} className={s.icon} />
                  </span>
                </div>
                <h3>{door.title}</h3>
                <p>{door.body}</p>
                <div className={cx(s.cardFoot, s.cardFootRule)}>
                  {door.links.map((link) => (
                    <a key={link.href} href={link.href}>
                      {link.label}
                      <Icon name="arrow" className={s.icon} />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id={SECTION.security} className={s.section} aria-labelledby="security-title">
          <div className={s.sectionHead}>
            <Kicker>What the code enforces</Kicker>
            <h2 id="security-title" className={s.h2}>
              Security
            </h2>
            <p className={s.intro}>Buyers pay on Dodo&apos;s hosted checkout every time, so no card details pass through OpenMoR. The threat model lists where each control lives.</p>
          </div>
          <ul className={s.securityGrid}>
            {SECURITY_CONTROLS.map((control) => (
              <li key={control.title} className={s.securityCard}>
                <div className={s.securityHead}>
                  <span className={s.iconBubble}>
                    <Icon name={control.icon} className={s.icon} />
                  </span>
                  <h3>{control.title}</h3>
                </div>
                <p>{control.body}</p>
              </li>
            ))}
          </ul>
          <p className={s.warning}>
            <strong>Prompt injection.</strong> {PROMPT_INJECTION_NOTE}
          </p>
          <div className={s.links}>
            <a href={DOCS.threatModel}>
              Threat model
              <Icon name="arrow" className={s.icon} />
            </a>
            <span aria-hidden="true">/</span>
            <a href={DOCS.security}>
              SECURITY.md
              <Icon name="arrow" className={s.icon} />
            </a>
          </div>
        </section>

        <section id={SECTION.limits} className={s.section} aria-labelledby="limits-title">
          <div className={s.sectionHead}>
            <Kicker>Roadmap, no dates</Kicker>
            <h2 id="limits-title" className={s.h2}>
              What it can&apos;t do yet
            </h2>
            <p className={s.intro}>{CANT_DO_YET}</p>
          </div>
          <ol className={s.grid}>
            {ROADMAP.map((item, i) => (
              <li key={item.title} className={s.card}>
                <span className={s.cardLabel}>Roadmap // {pad(i + 1)}</span>
                <h3 className={s.roadmapTitle}>{item.title}</h3>
                <p>{item.body}</p>
                <div className={cx(s.cardFoot, s.cardFootRule)}>
                  <span className={s.status}>{item.status}</span>
                </div>
              </li>
            ))}
          </ol>
          <div className={s.links}>
            <a href={DOCS.savedPayments}>
              Why repeat purchases are blocked
              <Icon name="arrow" className={s.icon} />
            </a>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={cx(s.wrap, s.footerInner)}>
          <p>© 2026 Praful Kharpuriye</p>
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
