# Wallet architecture

## Key material

The browser creates/imports keys locally. Mnemonics are converted to BIP32 using the MWC network parameters, then the supplied MWC bitcoinJS build handles ECPair/address/transaction operations.

Supported imports: BIP39 mnemonic, WIF, raw 32-byte private key, xprv, xpub watch-only.

## Send flow

1. Query `/balance/:address` and `/unspent/:address`.
2. Select confirmed UTXOs locally.
3. Construct P2PKH outputs locally.
4. Sign every input locally.
5. Show the resulting raw transaction.
6. User explicitly chooses broadcast.
7. Send only the signed raw transaction to `/broadcast`.

## CLTV flow

The lock builder creates:

`<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG`

and wraps it in P2SH. A lock transaction is signed locally and can be broadcast exactly like a normal transaction.

The wallet UI tracks locks it creates in the browser's `localStorage`, keyed to the active
wallet's public key (nothing is sent to the API). "My locks" re-derives each lock's status
live from the chain on refresh - it never trusts the locally stored record for whether a lock
is actually spendable, only for the address/script/unlock time themselves. A lock only shows a
Redeem button once the chain confirms both that the unlock time has passed and that the address
still holds funds. Redeeming builds a normal P2SH spend with `nLockTime` set to the lock's
unlock time and each input's `nSequence` set to the non-final value CLTV requires, signs it
locally, and hands the raw transaction to the Send tab for the user to broadcast.

## Stateless endpoints

`locks` and `owed` cannot truthfully be numeric database-like ledgers without a chain index or deterministic upstream endpoint. The implementation returns explicit unavailable status instead of fabricating state.
