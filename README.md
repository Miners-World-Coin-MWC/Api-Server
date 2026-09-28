# Miners World Coin — Non-Custodial Wallet API/SDK

A GitHub-hosted, database-free, Cloudflare-free MWC wallet SDK/API layer.

## Architecture

This project is intentionally **not a server pretending to be GitHub Pages**.

GitHub Pages hosts the wallet/SDK source and static assets. The SDK talks directly to:

`https://api.minersworld.org`

Private keys, mnemonics, WIFs and seeds stay in the user's browser/app. Only public blockchain data and fully signed raw transactions are sent to the original MWC API.

## Included

- Original MWC API client wrappers
- New `/api/*` logical wallet endpoints
- MWC network parameters
- Balance + UTXO aggregation
- History + confirmations
- Chain/node information
- Chain parameters
- Minimum lock configuration
- CLTV lock-script builder
- CLTV lock/spend transaction helpers
- Vanity-address generation (local only, maximum requested prefix length 6)
- Broadcast helper
- Static GitHub Pages demo
- GitHub Pages deployment workflow
- No database
- No Cloudflare
- No API key requirement
- No private-key transmission to the API

## Important

GitHub Pages cannot execute server-side Node/Python/Express code. Therefore `/api/*` in this project means SDK methods that expose those logical endpoints client-side.

For example:

```js
const api = new MWCWalletAPI();

await api.balance("MWC_ADDRESS");
await api.history("MWC_ADDRESS");
await api.nodechain();
await api.paramschain();
```

The underlying requests are made directly to `api.minersworld.org`.

## MWC parameters

```text
PUBKEY_ADDRESS = 20 (0x14)
SCRIPT_ADDRESS = 10 (0x0A)
SECRET_KEY     = 123 (0x7B)

EXT_PUBLIC_KEY = 04 88 B2 1E
EXT_SECRET_KEY = 04 88 AD E4

Bech32 HRP = mwc
```

CLTV:

```text
<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG
```

## bitcoinjs-lib

The project is wired to the MWC Explorer bitcoinjs-lib file:

https://raw.githubusercontent.com/Miners-World-Coin-MWC/explorer/refs/heads/main/js/bitcoinJS-lib.js

The GitHub Actions workflow downloads that exact file into `vendor/bitcoinJS-lib.js` during the build because this environment cannot bundle a remote file into the repository automatically.

If you commit `vendor/bitcoinJS-lib.js` yourself, the build will use it and will not download it again.

## Local development

```bash
npm install
npm run build
npm run test
npm run dev
```

The demo can be served with any static server.

## Security model

This SDK never sends:

- private keys
- WIFs
- mnemonics
- seed phrases
- xprvs

to `api.minersworld.org`.

The `/broadcast` call receives only a raw signed transaction.

Do not put secrets in URLs, query strings, logs, analytics, or browser localStorage.

## Vanity addresses

Vanity generation is local and CPU-bound. A six-character prefix can require a very large number of attempts depending on the requested prefix. The SDK therefore:

- caps the requested prefix at 6 characters
- supports cancellation
- reports progress
- never sends the private key to a server

The resulting address remains a normal MWC address derived from a real private key.

## CLTV

The SDK builds the requested script:

```text
<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <pubkey> OP_CHECKSIG
```

When spending a CLTV output, the transaction must use a compatible `nLockTime` and non-final input sequence. The SDK validates those conditions before building a spend.

## No database

All chain-derived information comes from the MWC blockchain API. Nothing is persisted by this project.

