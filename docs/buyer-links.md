# Buyer links and saved-card checkout

A **buyer link** is a buyer's email-approved permission for an AI agent to charge the buyer's
saved card at one merchant, without a payment page each time. The buyer sets the limits.

```
agent  --link_buyer-->  OpenMoR  --email-->  buyer
                                              |  opens /approve/{token}, reads the limits, presses Approve
agent  <-get_buyer_link-- OpenMoR <-----------+
agent  --checkout(mode: saved_method, buyer_link_id)-->  OpenMoR  --charge saved card-->  Dodo
```

## Tools

| Tool | What it does |
| --- | --- |
| `link_buyer` | Creates a pending link and emails the buyer a one-time approval link (valid 30 minutes). Input: `merchant_id`, `buyer_email`, `monthly_cap {amount, currency}`, optional `per_order_cap`, `product_ids`, `expires_in_days` (1 to 90, default 30). Amounts are whole minor units (5000 = 50.00). |
| `get_buyer_link` | Status, limits, spent this month, remaining. Needs the buyer's email. |
| `revoke_buyer_link` | Cancels a pending or active link. Needs the buyer's email. |
| `checkout` | `mode: "saved_method"` plus `buyer_link_id` charges the saved card. |

## Rules

- **Monthly cap.** Per calendar month in UTC. This month's spend is computed from the link's
  saved-method orders (paid, fulfilled, or sent and awaiting confirmation). Nothing is stored, so
  a new month starts at zero by itself.
- **Approval.** Looking at the page never approves anything (email scanners open links). Only the
  Approve button, a POST, does. The emailed link moves its token into a short-lived HttpOnly
  cookie and redirects to `/approve`, so the token does not stay in the URL. Tokens are
  single-use and expire after 30 minutes. Only the SHA-256 of a token is stored.
- **Saved card.** On Approve, OpenMoR finds the Dodo customer by email and their saved card. With
  none, the buyer is told to buy once with a normal checkout first and the link stays pending.
  Only the Dodo customer id and payment method id are stored. No card data touches OpenMoR.
- **FX drift.** A saved-card charge goes ahead only if the re-checked total is at most 1% above
  the quoted total (`PRICE_CHANGED` with a fresh quote otherwise), within the per-purchase cap and
  what is left of the monthly cap (`LIMIT_EXCEEDED` otherwise, saying how much is left), and the
  product is in scope.
- **Spend is reserved before the charge**, with the link row locked, so two quick purchases cannot
  both fit under the cap.
- **Buyer must be present.** If Dodo cannot charge without the buyer, the order becomes a normal
  hosted checkout link and the agent is told so. Subscriptions and non-binding (BYOP) prices
  always use the hosted page: a subscription renews outside any cap.
- **Unknown outcome.** If a charge times out or Dodo answers 5xx, a payment may exist. The order
  is kept (still counted against the cap) and the payment webhook settles it. A retry with the
  same quote and email returns that order and never charges twice.
- **Idempotency.** Same key as handoff checkout: hash(quote_id + buyer email).

## Not verified against live Dodo

These were built from the SDK types, not observed. Check them in test mode (steps below):

1. **Whether Dodo's hosted checkout saves the card.** For `prafulkharpuriya@gmail.com` in the dev
   merchant's test account, Dodo had a customer but **no saved card** after an earlier purchase.
   If no purchase ever saves a card, saved-card checkout cannot work.
2. **How "buyer must be present" shows up.** We treat payment statuses `requires_customer_action`,
   `requires_payment_method`, `requires_confirmation`, `failed` and `cancelled`, and any 4xx
   refusal of the charge, as "send the buyer to the hosted page". If Dodo reports it differently,
   change `BUYER_NEEDED_STATUSES` and the 4xx rule in `src/adapters/dodo/adapter.ts`.
3. **`recurring_enabled`.** Cards marked `false` are skipped. Its exact meaning is undocumented.

## Test it end to end on your machine

Uses the dev database in `.env` (the migration is already applied there; on another database run
`pnpm prisma migrate deploy` first) and Dodo **test mode**. Resend's test sender
`onboarding@resend.dev` can only email your own Resend account address, so use that address as the
buyer email.

**1. Tunnel.** Dodo's webhooks and the emailed link need a public https address.

```powershell
winget install --id Cloudflare.cloudflared      # once
cloudflared tunnel --url http://localhost:3000
```

It prints `https://<something>.trycloudflare.com`. The address changes every time you start it.

**2. Point the app at the tunnel.** In `.env` set `APP_URL` to that address (no trailing slash).
Change it back afterwards.

```powershell
pnpm dev
```

**3. Dev webhook endpoint.** In the Dodo dashboard, in **test mode**: Developer, Webhooks, add an
endpoint with this URL, replacing the host with your tunnel:

```
https://<tunnel>.trycloudflare.com/api/webhooks/dodo/cmvjjxa7a00009gvpwk39v4vd
```

(`cmvjjxa7a00009gvpwk39v4vd` is the dev ShareThings merchant id. `pnpm merchant:webhook sharethings`
prints the path for any merchant.) Subscribe it to the payment events (`payment.succeeded`,
`payment.failed`, `payment.cancelled`, `payment.processing`). Copy the endpoint's signing secret
(`whsec_...`), then store it, encrypted:

```powershell
pnpm merchant:webhook sharethings      # paste the secret when asked
```

When you restart the tunnel, edit the endpoint's URL in Dodo to the new address.

**4. Connect Claude Code to your local server.**

```powershell
claude mcp add --transport http openmor-dev http://localhost:3000/api/mcp
```

**5. Buy once with no link, so a card is saved.** Ask Claude: *"Buy ShareThings Storage Credits
for me. I'm in Germany, my email is <your Resend account address>."* Open the pay link and pay with
a Dodo test card (4242 4242 4242 4242, any future date, any CVC). If the page offers to save or
remember the card, tick it. Then check it was saved:

```powershell
pnpm merchant:cards sharethings <your Resend account address>
```

If it says **no saved card**, stop here: that is open question 1 above, and the rest cannot work
until a card is saved.

**6. Create the link.** Ask Claude: *"I'd like you to be able to buy ShareThings products for me
without asking each time. Limit it to 50 euro a month and 20 euro per purchase."* Claude calls
`link_buyer` and says to check your email.

**7. Approve by email.** Open the email, click the link, read the limits, press **Approve**. You
should see "Approved". (If you see "Buy once with a normal checkout first, so a card is saved",
step 5 did not save a card.) Ask Claude to check the link: it calls `get_buyer_link` and should
report it active with the full cap left.

**8. Buy with the link.** Ask Claude: *"Buy another ShareThings Storage Credits."* It gets a quote,
calls `checkout` with `mode: "saved_method"`, and the order is paid with no page. Ask it for the
order (`get_order`). `get_buyer_link` now shows the spend and what is left.

**9. Try the limits.**
- Ask Claude to buy until the month is used up: it should report `LIMIT_EXCEEDED` and how much is left.
- Ask it to revoke the link, then buy again: it should be refused with `BUYER_NOT_LINKED`.

If step 8 gives you a pay link instead of charging, Dodo needed you present: the answer says so,
and it shows how Dodo reports that (open question 2).

Your tunnel's request logs and Vercel's both record `/approve/{token}` URLs. Tokens are one-time
and expire in 30 minutes.
