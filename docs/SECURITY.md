# Security model

## Never send private material to the API

Never send any of these to `api.minersworld.org`:

- mnemonic
- seed
- private key
- WIF
- xprv
- wallet password

The API should receive only:

- public addresses
- public keys where required
- raw signed transactions
- normal blockchain queries

## Browser storage

This project does not automatically persist private keys.

If the eventual wallet app needs persistence, use platform secure storage and encrypt wallet material with a user-derived secret. Do not casually put private keys into `localStorage`.

## Vanity generation

Vanity generation is local. The generated private key must be shown/exported only to the user and must never be uploaded.

## CLTV

Always verify:

1. unlock time
2. current chain time/height semantics
3. transaction `nLockTime`
4. input sequence is non-final
5. redeem script matches the intended public key

Do not assume a timestamp/height interpretation without confirming the MWC consensus rule used by the node.

## Broadcast

Broadcast only after local transaction validation and signing.
