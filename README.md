# Miners World Coin API + Non-Custodial Wallet Core

This repository is the GitHub-first production foundation for the Miners World Coin (MWC) web wallet and API gateway.

Everything lives in this repo and runs from GitHub: a Cloudflare Worker (deployed by GitHub
Actions) and a static browser wallet (deployed to GitHub Pages by GitHub Actions). There is
no database and no server-side account system anywhere in this stack.

## Architecture

```text
GitHub
  │
  ├── source
  ├── CI
  └── GitHub Actions
          │
          ▼
   Cloudflare Workers  (stateless — no database)
          │
          ├── /info, /price, /height/... etc → original MWC API (proxied)
          ├── /broadcast → original MWC API (proxied)
          └── /api/* → new wallet API (nodechain, paramschain, balance,
                        history, locks, owed, healthsync — all computed
                        live from public chain data, nothing stored)

Browser wallet
  │
  ├── mnemonic / private key
  ├── address derivation
  ├── UTXO selection
  ├── transaction construction
  ├── CLTV construction
  └── local signing
          │
          ▼
      signed raw tx
          │
          ▼
       POST /broadcast
```

The API is **not custodial**. It never needs a user's mnemonic or private key, and it never
stores anything on a user's behalf — there is no admin key anywhere in this project. Whether
someone locks their coins is entirely their own decision, made and executed client-side.

## MWC Core compatibility

The wallet core follows the current MinersWorldCoin Core source for:

- transaction version `2`
- legacy transaction serialization
- SegWit transaction serialization
- `nLockTime`
- `OP_CHECKLOCKTIMEVERIFY` (`0xb1`)
- Bitcoin-style `SIGHASH_ALL`/BIP143 semantics
- MWC mainnet Base58 parameters

The MWC Core repository documents the mainnet parameters as pubkey prefix 20, script prefix 10, WIF prefix 123, xpub `0488b21e`, xprv `0488ade4`, and Bech32 HRP `mwc`. It also has SegWit and CLTV/CSV enabled. Verify these values against Core whenever the chain protocol changes.

## API endpoints

All original API paths are proxied unchanged:

- `GET /info`
- `GET /price`
- `GET /height/:height`
- `GET /block/:hash`
- `GET /header/:hash`
- `GET /range/:height`
- `GET /balance/:address`
- `GET /mempool/:address`
- `GET /unspent/:address`
- `GET /history/:address`
- `GET /transaction/:hash`
- `GET /mempool`
- `GET /peers`
- `GET /supply`
- `GET /fee`
- `GET /decode/:raw`
- `POST /broadcast`

New API — every one of these is stateless and public, no key required:

- `GET /api/nodechain` — height, peers, sync state, difficulty
- `GET /api/paramschain` — chain parameters and CLTV lock terms
- `GET /api/minimum` — today's minimum lockup
- `GET /api/healthsync` — API + chain sync status
- `GET /api/balance/:address` — confirmed balance and UTXOs
- `GET /api/history/:address` — received transactions, with confirmations
- `GET /api/locks/:pubkey?unlock_time=...&lock_type=height|time` — checks a single CLTV lock
- `GET /api/owed/:pubkey?unlock_times=1780000000,850000` — checks several CLTV locks at once and sums what's currently claimable

### Why locks/owed need no database

A CLTV lock's address is 100% deterministic from `(pubkey, unlock_time)`. Whoever created the
lock built the script and broadcast the transaction themselves, client-side — so they already
know both values. `/api/locks/:pubkey` and `/api/owed/:pubkey` don't look anything up in
storage; they recompute the same P2SH address on demand and ask the original chain API what's
actually sitting there right now. Nothing is registered, indexed, or persisted anywhere.

One consequence: if you forget the `unlock_time` you used, there's no way to recover it from
the server — the wallet is responsible for remembering the locks it created (e.g. in its own
local storage), the same way it's responsible for the private key.

## GitHub-hosted web wallet

The `web-wallet/` directory is a Vite browser wallet reference application.

GitHub Actions deploys it to GitHub Pages. The browser does the sensitive work locally:

- mnemonic handling
- derivation
- UTXO selection
- transaction construction
- signing

Only the signed raw transaction is sent to the API.

Enable GitHub Pages for the repository with **GitHub Actions** as the source. After that, pushes to `main` rebuild the wallet automatically.

## One-time Cloudflare setup

### 1. Create a Cloudflare API token

Create a scoped token that can deploy this Worker.

Store these GitHub Actions secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Do not commit either of these values.

### 2. Cloudflare custom domain

The Wrangler configuration uses:

```text
api2.minersworld.org
```

as a Cloudflare Worker Custom Domain.

Your `minersworld.org` zone must be active in Cloudflare. On first deployment Cloudflare can create the DNS record and certificate for the Custom Domain.

If you want a different hostname, change the `routes` entry in `wrangler.jsonc`.

### 3. Push to GitHub

After the secrets are configured:

```bash
git add .
git commit -m "Add production MWC API and non-custodial wallet core"
git push origin main
```

GitHub Actions then:

1. installs dependencies
2. typechecks
3. runs tests
4. deploys the Worker straight from `wrangler.jsonc`
5. runs a smoke test

## Local development

Run:

```bash
npm install
npm run dev
```

The Worker will be available on Wrangler's local URL. There's no local database step — the
Worker only needs the vars in `wrangler.jsonc` / `.dev.vars`.

For local secrets (currently just the optional broadcast key):

```bash
cp .dev.vars.example .dev.vars
```

## Wallet core

`src/mwc.ts` is the browser-safe MWC transaction module.

It provides:

- MWC network configuration
- mnemonic generation
- mnemonic → seed
- BIP32 derivation
- legacy P2PKH addresses
- SegWit P2WPKH addresses
- P2SH addresses
- CLTV redeem scripts
- CLTV P2SH addresses
- PSBT transaction construction
- local transaction signing
- raw transaction extraction

`src/lib/lockScript.ts` is a small, WASM-free subset of the same CLTV/P2SH math, used only by
the Worker to *verify* a lock address someone asks about — never to sign or move funds.

### Standard receive address

For legacy P2PKH:

```ts
const node = masterNodeFromMnemonic(mnemonic)
  .derivePath("m/44'/20'/0'/0/0");

const address = legacyAddressFromNode(node);
```

### CLTV

The requested script is constructed as:

```text
<unlock-time>
OP_CHECKLOCKTIMEVERIFY
OP_DROP
<public-key>
OP_CHECKSIG
```

The wallet can turn that redeem script into an MWC P2SH address, fund it with a normal
transaction, and later spend from it once the lock time has passed. All of this — deciding to
lock, building the script, broadcasting the funding transaction, and later reclaiming the
funds — happens entirely client-side with the user's own key. The API is never asked to
approve, register, or track any of it; `/api/locks/:pubkey` and `/api/owed/:pubkey` are purely
a convenience for checking status, described above.

Important: CLTV is enforced by the transaction's `nLockTime` and input `nSequence`. MWC Core checks that the lock-time type matches, that the transaction lock time is at least the script lock time, and that the spending input is not `SEQUENCE_FINAL`.

## Sending

The browser should:

1. derive the sender address locally
2. request `/api/balance/<address>?with_prevtx=1`
3. select UTXOs locally
4. construct outputs locally
5. calculate change locally
6. construct the transaction locally
7. sign with the local private key
8. serialize the signed transaction
9. POST only the signed transaction to `/broadcast`

The API should never receive:

- mnemonic
- seed
- private key
- WIF
- wallet password

The API only receives public blockchain information and, for broadcasting, an already-signed transaction.

## Amounts

Amounts are stored and returned as integer atomic units.

Never use floating-point MWC amounts for accounting.

For example:

```text
1 MWC = 100000000 atomic units
```

## Production security

Recommended production controls:

- keep Cloudflare API credentials only in GitHub Secrets
- never log private keys or mnemonics
- keep the original node RPC port private
- put Cloudflare rate limiting/WAF in front of `/broadcast`
- monitor `/api/healthsync`
- review all transaction-building changes against MWC Core before release

## Important transaction compatibility rule

Do not replace `src/mwc.ts` with generic Bitcoin transaction code without checking MWC Core.

The current Core source shows that MWC's transaction structure follows Bitcoin-style serialization, including version, inputs, outputs, witness data and locktime. Its signature hashing also implements legacy and SegWit hashing rules. The repository therefore deliberately uses the BitcoinJS transaction primitives with MWC's network parameters rather than inventing a separate transaction format.

The final release should add golden-vector tests generated directly by `minersworldcoin-cli`/MWC Core for:

- P2PKH spend
- P2WPKH spend
- P2SH spend
- CLTV P2SH spend
- SIGHASH_ALL
- transaction ID
- witness transaction ID
- raw serialization

Those vectors should be treated as consensus compatibility tests.
