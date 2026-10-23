# OpenMoR

Open-source layer that lets AI agents discover, quote, buy and receive digital products from merchants who sell through a merchant of record (MoR). [Dodo Payments](https://dodopayments.com) is the first provider.

> Status: early scaffold. No features yet.

## Planned front doors (v1)

- **MCP connector**: `search_products`, `get_product`, `get_quote`, `checkout`, `get_order`
- **Agent-readable product pages** with `llms.txt` and pre-filled checkout links
- **UCP profile** per merchant (`/.well-known/ucp`)
- **ACP product feed** per merchant

## What agents can and cannot do

- An agent finds products, gets a binding quote (with tax for the buyer's country) and gets a checkout link. **The buyer pays on Dodo's hosted checkout page for every purchase.** Agents never handle card details.
- **Agent-initiated repeat purchases are not supported.** An agent cannot charge a buyer's saved card later without the buyer present: Dodo does not currently expose a reusable saved method for one-time checkouts. The unfinished work (buyer approval links with spending caps) is parked on the `feat/buyer-links` branch. See [docs/dodo-saved-payments.md](docs/dodo-saved-payments.md) for what was tested and what would unblock it.

## Development

Requires Node.js 20+ and pnpm.

```powershell
pnpm install
Copy-Item .env.example .env   # then fill in the values
pnpm db:generate
pnpm dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## License

[Apache-2.0](LICENSE) © Praful Kharpuriye
