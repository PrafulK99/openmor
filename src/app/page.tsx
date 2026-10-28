// The landing page. Fully static: it imports only its own copy (./_home/content.ts) and never reads the
// database or calls Dodo, so it renders even when both are down.
import Link from "next/link";
import {
  DOCS,
  FRONT_DOORS,
  homeMetadata,
  LIMITS,
  MCP_ADD_COMMAND,
  REPO_URL,
  AUTHOR_URL,
  ROADMAP,
  SAMPLE_PROMPT,
  SECTION,
  SECURITY_CONTROLS,
  STATS,
  STEPS,
} from "./_home/content";
import s from "./_home/home.module.css";

export const metadata = homeMetadata(process.env.APP_URL);

const cx = (...names: string[]) => names.join(" ");

export default function Home() {
  return (
    <div className={s.page}>
      <a className={s.skip} href="#main">
        Skip to content
      </a>

      <div className={s.notice} role="note">
        <div className={s.wrap}>
          <p>
            <strong>Test catalog.</strong> The live catalog is a Dodo test-mode merchant. Its products are marked [TEST], and no real purchases happen.
          </p>
        </div>
      </div>

      <header className={s.header}>
        <div className={cx(s.wrap, s.headerInner)}>
          <Link className={s.wordmark} href="/" aria-label="OpenMoR home">
            Open<span>MoR</span>
          </Link>
          <nav className={s.nav} aria-label="Sections">
            <a href={`#${SECTION.how}`} className={s.navOptional}>
              How it works
            </a>
            <a href={`#${SECTION.tryIt}`}>Try it</a>
            <a href={`#${SECTION.security}`} className={s.navOptional}>
              Security
            </a>
            <a href={REPO_URL}>GitHub</a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className={s.hero} aria-labelledby="hero-title">
          <div className={cx(s.wrap, s.heroGrid)}>
            <div>
              <p className={s.eyebrow}>Open source · Apache-2.0</p>
              <h1 id="hero-title" className={s.h1}>
                Make your digital products buyable by AI agents.
              </h1>
              <p className={s.lede}>
                OpenMoR lets AI agents find, quote and buy digital products from merchants who sell through a merchant of record, with quotes priced by the provider for the
                buyer&apos;s country and payment on its hosted checkout.
              </p>
              <p className={s.builtFor}>Built first for merchants of record such as Dodo Payments.</p>
              <div className={s.actions}>
                <a className={cx(s.button, s.primary)} href={`#${SECTION.tryIt}`}>
                  Try it
                </a>
                <a className={s.button} href={REPO_URL}>
                  View on GitHub
                </a>
              </div>
            </div>
            <pre className={s.code} aria-label="Example: a quote request over MCP">
              <span className={s.comment}>{"// get_quote: what an agent sends\n"}</span>
              {'{\n  "merchant_id": "…",\n  "product_id": "…",\n  "buyer_country": "DE"\n}\n\n'}
              <span className={s.comment}>{"// what it gets back, among other fields\n"}</span>
              {"quote_id · total (tax included)\ntax_rate_percent · is_binding\nexpires_in_seconds"}
            </pre>
          </div>
        </section>

        <section aria-label="OpenMoR in numbers">
          <div className={s.wrap}>
            <dl className={s.stats}>
              {STATS.map((stat) => (
                <div key={stat.label} className={s.stat}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
            <p className={s.statNote}>Counted from the code in the repository.</p>
          </div>
        </section>

        <section id={SECTION.how} className={s.section} aria-labelledby="how-title">
          <div className={s.wrap}>
            <div className={s.sectionHead}>
              <h2 id="how-title" className={s.h2}>
                How a purchase works
              </h2>
              <p className={s.intro}>Four steps, each one tool call. The buyer stays in control of the payment.</p>
            </div>
            <ol className={s.grid}>
              {STEPS.map((step, i) => (
                <li key={step.title} className={s.card}>
                  <span className={s.stepNumber} aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <div className={s.tools}>
                    {step.tools.map((tool) => (
                      <code key={tool} className={s.tool}>
                        {tool}
                      </code>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id={SECTION.tryIt} className={s.section} aria-labelledby="try-title">
          <div className={s.wrap}>
            <div className={s.sectionHead}>
              <h2 id="try-title" className={s.h2}>
                Try it
              </h2>
              <p className={s.intro}>Connect Claude Code to the live connector, then ask for a quote. The catalog is in test mode, so nothing is charged.</p>
            </div>
            <div className={s.tryGrid}>
              <div>
                <p className={s.stepLabel}>1. Add the connector</p>
                <pre className={s.code}>
                  <span className={s.prompt}>{"$ "}</span>
                  {MCP_ADD_COMMAND}
                </pre>
                <p className={s.small}>Any MCP client that supports Streamable HTTP can use the same URL.</p>
              </div>
              <div>
                <p className={s.stepLabel}>2. Ask your agent</p>
                <pre className={s.code}>{SAMPLE_PROMPT}</pre>
                <p className={s.small}>You should get a quote with German VAT and a link to Dodo&apos;s test checkout.</p>
              </div>
            </div>
          </div>
        </section>

        <section id={SECTION.doors} className={s.section} aria-labelledby="doors-title">
          <div className={s.wrap}>
            <div className={s.sectionHead}>
              <h2 id="doors-title" className={s.h2}>
                Four front doors, one core
              </h2>
              <p className={s.intro}>Every listed merchant is reachable the way an agent prefers to read. All four are served by one core and one catalog.</p>
            </div>
            <ul className={s.grid}>
              {FRONT_DOORS.map((door) => (
                <li key={door.title} className={s.card}>
                  <h3>{door.title}</h3>
                  <p>{door.body}</p>
                  <div className={s.cardLinks}>
                    {door.links.map((link) => (
                      <a key={link.href} href={link.href}>
                        {link.label}
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id={SECTION.security} className={s.section} aria-labelledby="security-title">
          <div className={s.wrap}>
            <div className={s.sectionHead}>
              <h2 id="security-title" className={s.h2}>
                Security
              </h2>
              <p className={s.intro}>A payments project, so these controls are not optional. Each one is in the code, and the threat model says where.</p>
            </div>
            <ul className={s.grid}>
              {SECURITY_CONTROLS.map((control) => (
                <li key={control.title} className={s.card}>
                  <h3>{control.title}</h3>
                  <p>{control.body}</p>
                </li>
              ))}
            </ul>
            <div className={s.moreLinks}>
              <a href={DOCS.threatModel}>Read the threat model</a>
              <a href={DOCS.security}>Report a vulnerability (SECURITY.md)</a>
            </div>
          </div>
        </section>

        <section id={SECTION.limits} className={s.section} aria-labelledby="limits-title">
          <div className={cx(s.wrap, s.twoCol)}>
            <div>
              <h2 id="limits-title" className={s.h2}>
                What it can&apos;t do yet
              </h2>
              <ul className={cx(s.list, s.listAfterHeading)}>
                {LIMITS.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
              <p className={s.small}>
                Why repeat purchases are blocked: <a href={DOCS.savedPayments}>what was tested with Dodo</a>.
              </p>
            </div>
            <div>
              <h3 className={s.h3}>Roadmap</h3>
              <p className={cx(s.small, s.roadmapNote)}>
                No dates are promised.
              </p>
              <ul className={s.list}>
                {ROADMAP.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={cx(s.wrap, s.footerInner)}>
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
              <a href={DOCS.license}>Apache-2.0 licence</a>
            </li>
          </ul>
          <p>
            Built by <a href={AUTHOR_URL}>Praful Kharpuriye</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
