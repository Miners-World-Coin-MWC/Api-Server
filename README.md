# Miners World Coin — Production Non-Custodial Wallet + Stateless API

This repository is the **wallet as well as the API layer**.

## What is included

- Full browser wallet UI hosted from GitHub Pages
- New wallet creation
- BIP39 mnemonic import/generation
- WIF import
- raw private-key import
- xprv import
- xpub watch-only import
- MWC address derivation using the supplied network parameters
- local vanity-address generation, maximum 6 characters
- balance + UTXO discovery
- transaction history
- local transaction construction/signing
- raw transaction broadcast through the original MWC API
- CLTV lock-script/address generation
- CLTV lock transaction construction/signing
- encrypted wallet backup using PBKDF2-SHA256 + AES-256-GCM
- stateless API facade retaining the complete original endpoint surface
- new logical `/api/*` methods
- GitHub Pages deployment
- no database
- no Cloudflare
- no API keys
- no server-side private-key storage

## MWC network

`PUBKEY_ADDRESS=20`, `SCRIPT_ADDRESS=10`, `SECRET_KEY=123`, `EXT_PUBLIC_KEY=0488B21E`, `EXT_SECRET_KEY=0488ADE4`, `bech32=mwc`.

CLTV template:

`<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG`

## Original API

All authoritative chain operations use `https://api.minersworld.org` directly. The wallet does not replace or fake the original API.

## GitHub Pages reality

GitHub Pages is static hosting. It cannot run a persistent server process. Therefore the wallet's API facade is a stateless browser SDK over the original API. The repository also contains the stateless Node adapter in `server/` for deployments that need literal HTTP `/api/*` routes. It stores nothing.

## Build

```bash
npm ci
npm run fetch-bitcoinjs
npm run build
```

The workflow downloads the exact MWC Explorer `bitcoinJS-lib.js` into `vendor/` and bundles the wallet around it. For a fully pinned release, commit that fetched vendor file into the repository and record its SHA-256 in the release notes.

## Important production security point

A wallet can be production-grade only if the exact MWC transaction/signature behavior is tested against MWC node test vectors. This repository therefore never sends key material to the API and never invents values for `owed`, `ledgerincome`, solvency, or lock history where the supplied upstream API does not expose authoritative data.
