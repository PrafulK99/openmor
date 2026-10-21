# OpenMoR

Open-source layer that lets AI agents discover, quote, buy and receive digital products from merchants who sell through a merchant of record (MoR). [Dodo Payments](https://dodopayments.com) is the first provider.

> Status: early scaffold. No features yet.

## Planned front doors (v1)

- **MCP connector**: `search_products`, `get_product`, `get_quote`, `checkout`, `get_order`
- **Agent-readable product pages** with `llms.txt` and pre-filled checkout links
- **UCP profile** per merchant (`/.well-known/ucp`)
- **ACP product feed** per merchant

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
