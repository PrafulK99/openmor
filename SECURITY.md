# Security policy

OpenMoR handles merchant API keys and sits in front of a payments flow, so security reports are welcome and taken seriously.

## Supported versions

Only the `main` branch (and what is deployed from it) is supported. There are no other maintained versions.

## How to report a vulnerability

**Please do not open a public issue or pull request for a security problem.**

1. **Preferred:** use GitHub's private vulnerability reporting. Open the repository's **Security** tab, choose **Report a vulnerability**, and fill in the form: <https://github.com/PrafulK99/openmor/security/advisories/new>.
2. **Fallback:** email the maintainer at **prafulk.dev@gmail.com** if you cannot use GitHub. Put "OpenMoR security" in the subject.

Never include live API keys, webhook secrets, licence keys or real buyer data in a report. If you found one exposed, say where, and do not use it.

### What to include

- What the problem is and which part is affected (a route, a tool, a file).
- Steps to reproduce, or a proof of concept, using test-mode data only.
- The impact as you understand it: what an attacker could read, change or spend.
- The commit or the date you tested, and whether it was the live test catalog or a copy you run yourself.
- Whether you plan to disclose it publicly, and when.

## Scope

**In scope**

- The OpenMoR application in this repository.
- The MCP connector (`/api/mcp`) and the public endpoints: the readable pages, markdown twins, `llms.txt`, the sitemap, and the UCP profile and catalog.
- Webhook handling (signature verification, replay and idempotency).
- Storage and handling of merchant keys and secrets.

**Out of scope**

- Dodo Payments' own systems and hosted checkout. Report those to Dodo Payments.
- Other third-party services (Vercel, Supabase, GitHub and so on).
- Test-mode data: the live catalog is a test catalog, and its products and checkout links are not real purchases.
- Denial of service by sheer volume, and anything needing physical access to a device.
- Reports from automated scanners with no demonstrated impact.

## Safe harbor

I will not take legal action against you for good-faith research that follows this policy: you stay within scope, use only test-mode data and your own accounts, avoid privacy violations and disruption of the service, do not access or keep other people's data, and give me reasonable time to fix the problem before you disclose it. If you are unsure whether something is allowed, ask first.

## What to expect

I aim to acknowledge reports within a few days and to keep you updated as I look into them. This is a best-effort project run by one maintainer, so I cannot promise a fixed response or fix time. There is no bug bounty.
