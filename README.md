# Miners World Coin API + Non-Custodial Wallet Core

This repository is the GitHub-first production foundation for the Miners World Coin (MWC) web wallet and API gateway.

Everything lives in this repo and runs from GitHub: a Node API server (run it in GitHub Codespaces or anywhere Node runs) and a static browser wallet (deployed to GitHub Pages by GitHub Actions). There is
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
   Node server  (stateless — no database, no API keys)
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
- `GET /api/ledgerincome` — on-chain income ledger (see below)
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

## Running the API server

No Cloudflare, no API keys, no database. It is a plain Node (Hono) server.

```bash
npm install
npm start          # http://localhost:8787
```

On GitHub: open the repo in a **Codespace** (`.devcontainer/` is included). It installs and starts the
server automatically; in the Ports tab, set port 8787 to Public to get a shareable URL. Note that
GitHub itself can't host an always-on server: a Codespace stops when idle. For a permanent URL, run the
same `npm start` on any machine/VPS that runs Node.

Optional environment variables: `PORT`, `ORIGINAL_API_URL` (default `https://api.minersworld.org`),
`CORS_ORIGIN`, `MWC_MIN_LOCK_SECONDS`, `INCOME_ADDRESS`, `ALLOCATION_ADDRESSES` (see Ledger).

The web wallet is still deployed to GitHub Pages by `.github/workflows/web-wallet.yml`; set its "API"
field to wherever your server runs (it defaults to `http://localhost:8787`).

## Ledger (on chain, no database)

`/api/ledgerincome` reads public chain data for wallets you designate. Create a wallet (the web wallet
can generate one, including a custom-prefix address), then start the server pointed at it:

```bash
INCOME_ADDRESS=9YourIncomeWalletAddress \
ALLOCATION_ADDRESSES=9VaultOne,9VaultTwo \   # optional
npm start
```

| field | meaning |
|---|---|
| `income_atomic` | everything ever received by `INCOME_ADDRESS` |
| `available_atomic` | what `INCOME_ADDRESS` still holds |
| `settled_atomic` | income minus available (what has left the income wallet) |
| `allocated_atomic` | total currently held by `ALLOCATION_ADDRESSES` |
| `solvent` | `available >= allocated` |

These definitions are my reading of "income, allocated, settled, solvency" done purely on chain.
If you meant something different, it's a small change in `ledgerincome()` in `src/routes/newApi.ts`.

## Web wallet features

- Import a private key (WIF), a mnemonic, or create a random wallet.
- Custom address generator: pick a prefix (starts with `9`, up to 4 chars); every address is still a
  valid MWC address (version byte 20).
- Send, with local signing; only the signed transaction is broadcast.
- Time lock (`<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <pubkey> OP_CHECKSIG`, P2SH): the user locks
  their own funds on chain and redeems them after the unlock time. No admin, no registration. The wallet
  remembers locks in the browser, and a lock can be recovered from your key plus its unlock time
  ("Track lock for this date"). Time-based locks compare against the chain's median time, which trails
  wall-clock time by roughly an hour, so a redeem right at the unlock time may be rejected until it passes.

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

- never log private keys or mnemonics
- keep the original node RPC port private
- put rate limiting in front of `/broadcast` if the server is public
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
