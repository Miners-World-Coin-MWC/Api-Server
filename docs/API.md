# Logical API

The following methods are exposed by `MWCWalletAPI`.

## Original API wrappers

```text
/info
/price
/height/:height
/block/:hash
/header/:hash
/range/:height?offset=
/balance/:address
/mempool/:address
/unspent/:address?amount=
/history/:address
/transaction/:hash
/mempool
/peers
/supply
/fee
/decode/:raw
/broadcast
```

## New logical endpoints

### GET /api/nodechain

SDK:

```js
api.nodechain()
```

Combines `/info` and `/peers`.

### GET /api/paramschain

SDK:

```js
api.paramschain()
```

Returns MWC network, address and CLTV parameters.

### GET /api/minimum

SDK:

```js
api.minimum()
```

Returns the current lock configuration. A numeric minimum is intentionally not fabricated because the exact chain-level minimum lock rule has not been supplied.

### GET /api/ledgerincome

SDK:

```js
api.ledgerincome()
```

Returns the status of chain-derived accounting. It does not invent an off-chain ledger.

### GET /api/healthsync

SDK:

```js
api.healthsync()
```

Combines sync state, peers and mempool information.

### GET /api/balance/:address

SDK:

```js
api.balance(address)
```

Combines balance, received amount, UTXOs and address mempool data.

### GET /api/history/:address

SDK:

```js
api.history(address)
```

Loads transaction hashes and enriches them with transaction data and confirmations.

### GET /api/locks/:pubkey

SDK:

```js
api.locks(pubkey)
```

A stateless implementation cannot maintain a historical lock index. Lock discovery should scan chain-derived transaction/UTXO data locally.

### GET /api/owed/:pubkey

SDK:

```js
api.owed(pubkey)
```

A numeric owed balance requires exact deterministic MWC reward/claim accounting rules. The project deliberately does not invent an off-chain balance.
