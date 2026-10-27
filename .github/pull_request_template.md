## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass (and `pnpm build` if routes, caching or the build changed)
- [ ] Tests added or updated (core functions have unit tests; adapter code has tests with a mocked SDK)
- [ ] No secrets, keys, licence keys or buyer data in the code, tests, logs or description
- [ ] Docs updated (README, `docs/`, `.env.example`) where behaviour or configuration changed
- [ ] Branch is from an up-to-date `main`, and commits are small Conventional Commits
- [ ] Architecture rules kept (protocol layers call core; only `src/adapters/dodo/` imports the Dodo SDK; money in integer minor units)
