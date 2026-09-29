# Pacts frontend

Single-page React app for the Pacts guild strategy game on Sepolia. It is built with Vite,
React 19, TypeScript and viem, exports to plain static files with a relative base, and runs from
any static host or IPFS gateway path without server rewrites (hash routing).

The committed production export lives at the repository root in `dist/`. Its runtime deployment
configuration is `dist/imd-deployment.json`.

## Configuration: one file, no secrets

Every address, chain setting, public RPC URL and ABI path the app uses comes from
`imd-deployment.json`, loaded at startup next to `index.html`:

| What | Where it comes from |
| --- | --- |
| Chain id, name, native currency, explorer, faucets | `network` block (copied unchanged from the network table) |
| Public RPC URLs (read-only, batched, with fallback) | `network.rpcUrls` |
| Uniswap v4 router, quoter, StateView, Permit2 | `network.uniswapV4` |
| `wallet_addEthereumChain` parameters | `walletAddChain` |
| LaunchToken, Guilds, Realm addresses and ABIs | `contracts[]` (`address`, `abiPath`, `abiHash`) |
| Diplomacy, Season, Banners addresses | read on chain: `Realm.diplomacy()`, `Realm.season()`, `Season.banners()` |
| Diplomacy, Season, Banners ABIs | `abi/<Name>.json` beside the handoff ABIs (naming convention in `src/config/deployment.ts`) |

Two build-time constants are derived from the deployment handoff and generated into
`src/config/launch.ts`: the Uniswap v4 pool key parameters (fee, tick spacing, paired currency,
hook) and the deployment block used as the lower bound for event log scans. The app checks the
block against chain code before trusting it.

There is no WalletConnect project id and no private RPC credential anywhere in the bundle. Only
injected browser wallets are offered (EIP-6963 discovery plus `window.ethereum`). To add
WalletConnect later, add its connector in `src/lib/wallet.ts` and keep the project id public.

## Install, run, build

Node 22 and npm are used; `package-lock.json` is the lockfile.

```sh
cd web
npm ci                      # install from the lockfile
npm run typecheck           # tsc --noEmit
npm test                    # vitest: unit + interaction tests against a mocked chain and wallet
npm run build               # typecheck + vite build -> ../dist (relative base)
npm run manifest            # rewrite ../dist/imd-deployment.json with SHA-256 of every exported file
npm run check-manifest      # verify the manifest the way the publication check does
npm run preview             # serve ../dist locally
```

Rebuild after every source change, then run `npm run manifest` and commit `dist/` together with
the source. The manifest lists every exported file except itself and must be regenerated whenever
the export changes.

### Refreshing the deployment handoff

`node scripts/sync-deployment.mjs` reads `.imd/reads/deployment.json`, `.imd/reads/network.json`
and `docs/abi/<Contract>.json`, verifies each handoff ABI hash (`keccak256` of the canonical JSON:
sorted keys, no whitespace), and writes `public/imd-deployment.json`, `public/abi/*.json` and
`src/config/launch.ts`. Options: `--handoff`, `--network`, `--abi-dir`.

## What the app does

- **Map**: live 12 by 12 grid from `Realm.map()`, coloured by guild with the guild number and
  garrison printed on each tile, attack markers from unsettled epochs, tile detail and an
  "Propose attack" control that fills in the Realm target and the current holder.
- **Guilds**: table of all guilds; a guild page with members (rebuilt from `MemberJoined`,
  `MemberLeft`, `MemberExpelled` logs), pending votes with per-member eligibility, execute /
  declare / buy-from-treasury / sign actions on approved proposals, a new-proposal form for every
  proposal kind, join / leave, treasury deposit (approve then deposit) and income collection.
  Proposals whose target is not the Realm or Diplomacy contract carry a red warning.
- **Diplomacy**: pacts with bonds and epoch windows, expire control, matching of approved pact
  offers into `Diplomacy.sign`, and the betrayal list from `PactBroken` logs.
- **Season**: live standings, prize pool, recorded standings per season, close / claim / mint peace
  banner, and the banner list from `BannerMinted` logs.
- **Events**: every decoded log since deployment, newest first, with a contract filter.
- **Play**: wallet balances and guild, approve-then-buy troops, permissionless settlement
  (`settle`, `settlePending`, `settleStep`).
- **Swap**: ETH to PACT and PACT to ETH through the Uniswap v4 Universal Router. Quotes use the
  quoter via `eth_call` simulation, slippage applies to the quoted output, PACT sales go through
  the two Permit2 approval steps, and every swap is simulated before the wallet is asked to sign.

Every transaction control is simulated first, disables itself while the wallet or the chain is
working, shows the hash while pending and translates custom errors into plain sentences
(`src/lib/errors.ts`). Wrong-network wallets get a single "Switch to Sepolia" control in the header
that falls back to `wallet_addEthereumChain` when the wallet reports an unknown chain (4902).

USD values are not shown: the site reads no price source. The swap page shows the pool's PACT per
ETH rate instead.

## Validation

See `docs/frontend-validation.md` for the build, typecheck, test, browser and design-review record,
including what was not exercised against the live chain. The design system is documented in
`docs/DESIGN.md`.

## Layout of this directory

```
web/
  index.html                 entry (relative asset paths, Open Graph tags)
  vite.config.ts             base './', outDir ../dist, vitest jsdom config
  public/imd-deployment.json runtime deployment configuration (assets filled in after build)
  public/abi/*.json          raw ABI arrays copied from docs/abi
  scripts/                   sync-deployment, manifest, check-manifest
  src/config/                deployment loader (single configuration surface), generated launch.ts
  src/lib/                   wallet (EIP-1193/6963), client, errors, format, swap encoding, logs
  src/state/                 game store (reads + log indexing), tx runner, React context
  src/components/, src/pages/
  src/test/                  mocked chain + wallet used by the tests and the browser fixture
```
