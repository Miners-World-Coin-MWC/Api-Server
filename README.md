# Miners World Coin API + Non-Custodial Wallet Core

This repository is the GitHub-first production foundation for the Miners World Coin (MWC) web wallet and API gateway.

## Architecture

```text
GitHub
  │
  ├── source
  ├── CI
  └── GitHub Actions
          │
          ▼
   Cloudflare Workers
          │
          ├── /info, /price, /height/... etc → original MWC API
          ├── /broadcast → original MWC API
          ├── /api/* → new wallet/ledger/lock API
          └── scheduled health job
                  │
                  ▼
             Cloudflare D1

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

The API is **not custodial**. It never needs a user's mnemonic or private key.

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

New API:

- `GET /api/nodechain`
- `GET /api/paramschain`
- `GET /api/minimum`
- `GET /api/ledgerincome`
- `GET /api/healthsync`
- `GET /api/balance/:address`
- `GET /api/history/:address`
- `GET /api/locks/:pubkey`
- `GET /api/owed/:pubkey`

Public, no key required:

- `POST /api/locks/register` — registers a lock for discovery by pubkey. Anyone can call
  this, but it's not trust-based: the server independently recomputes the CLTV redeem
  script + P2SH address from `(pubkey, unlock_time)` and only indexes it if that address
  is actually funded on-chain right now. There is no admin control over whether a user
  locks their coins — that's entirely the user's own decision, made client-side.

Administrative endpoints (ledger/reward bookkeeping only — never used for the lock decision itself):

- `POST /api/admin/workers/heartbeat`
- `POST /api/admin/ledger/entry`
- `POST /api/admin/treasury`

Admin endpoints require:

```text
Authorization: Bearer <ADMIN_API_KEY>
```

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

### 1. Create the D1 database

Run:

```bash
npm install
npx wrangler login
npx wrangler d1 create minersworld_api
```

Cloudflare will print the database ID. Put that ID into a GitHub Actions secret named:

```text
CLOUDFLARE_D1_DATABASE_ID
```

### 2. Create a Cloudflare API token

Create a scoped token that can deploy the Worker and manage the D1 database used by this project.

Store these GitHub Actions secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_D1_DATABASE_ID
MWC_ADMIN_API_KEY
```

Generate the admin key locally with:

```bash
openssl rand -hex 32
```

Do not commit any of these values.

### 3. Cloudflare custom domain

The Wrangler configuration uses:

```text
api2.minersworld.org
```

as a Cloudflare Worker Custom Domain.

Your `minersworld.org` zone must be active in Cloudflare. On first deployment Cloudflare can create the DNS record and certificate for the Custom Domain.

If you want a different hostname, change the `routes` entry in `wrangler.jsonc`.

### 4. Push to GitHub

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
4. generates the real Wrangler config from the D1 secret
5. applies D1 migrations
6. installs the admin API secret
7. deploys the Worker
8. runs a smoke test

## Local development

Create a local D1 database:

```bash
npx wrangler d1 migrations apply minersworld_api --local
```

Run:

```bash
npm run dev
```

The Worker will be available on Wrangler's local URL.

For local secrets:

```bash
cp .dev.vars.example .dev.vars
```

Set a real local `ADMIN_API_KEY`.

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

The wallet can turn that redeem script into an MWC P2SH address.

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

## Ledger

Amounts are stored as integer atomic units.

Never use floating-point MWC amounts for accounting.

For example:

```text
1 MWC = 100000000 atomic units
```

The D1 ledger keeps earned, allocated, settled, and adjustment entries.

`/api/owed/:pubkey` calculates:

```text
owed = earned + adjustments - settled
```

`/api/ledgerincome` calculates global outstanding funds and compares them against the configured treasury balance.

## Lock tracking

The public `/api/locks/:pubkey` endpoint reads registered lock watchers.

Anyone can register a CLTV lock they created — there is no admin key on this path, by design:

```text
POST /api/locks/register
{ "pubkey": "...", "unlock_time": 1780000000, "lock_type": "time" }
```

The user builds and broadcasts the actual locking transaction themselves, client-side,
with their own private key — the API never sees a private key and never decides whether
someone locks their coins. This endpoint just makes that lock discoverable afterwards.
It only accepts a `pubkey` and `unlock_time`; the server derives the redeem script and
P2SH address itself and checks the original chain API to confirm that address is really
funded before indexing it, so the index can't be poisoned with fake or unfunded locks.

Private keys are never required or accepted.

## Production security

Recommended production controls:

- keep Cloudflare API credentials only in GitHub Secrets
- keep the admin API key only in Worker Secrets
- never log private keys or mnemonics
- never store wallet seeds in D1
- keep the original node RPC port private
- put Cloudflare rate limiting/WAF in front of `/broadcast`
- monitor `/api/healthsync`
- use a separate admin key for production
- rotate admin credentials if exposed
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
