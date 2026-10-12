
/*
 * Miners World Coin — Vanity Address Worker
 *
 * Runs in a module Web Worker. Does not import the bitcoinjs UMD bundle.
 * Uses tiny-secp256k1 for public-key derivation and the existing
 * pure-JavaScript address encoder for MWC-compatible Base58Check addresses.
 *
 * Message protocol remains compatible with wallet-app.js:
 *   start    -> { type, prefix, pubKeyHashVersion, batchSize }
 *   stop     -> { type }
 *   progress -> { type, attempts }
 *   found    -> { type, privateKeyHex, address, attempts }
 */

import * as ecc from 'tiny-secp256k1';
import { p2pkhAddress } from './address-encode.js';

let running = false;
let runId = 0;

const DEFAULT_BATCH_SIZE = 3000;
const MAX_BATCH_SIZE = 100000;
const PRIVATE_KEY_LENGTH = 32;

/**
 * Generate a cryptographically secure, valid secp256k1 private key.
 * Invalid scalars are discarded rather than reduced or reused.
 */
function randomPrivateKey() {
  const key = new Uint8Array(PRIVATE_KEY_LENGTH);

  do {
    self.crypto.getRandomValues(key);
  } while (!ecc.isPrivate(key));

  return key;
}

/**
 * Convert bytes to lowercase hexadecimal without allocating an
 * intermediate array of individual byte strings.
 */
function toHex(bytes) {
  let hex = '';

  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }

  return hex;
}

/**
 * Validate and normalise the requested batch size.
 */
function normaliseBatchSize(value) {
  if (value === undefined || value === null) {
    return DEFAULT_BATCH_SIZE;
  }

  const size = Number(value);

  if (!Number.isSafeInteger(size) || size < 1) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(size, MAX_BATCH_SIZE);
}

/**
 * Search one batch of candidate keys.
 *
 * The run token prevents stale scheduled batches from continuing after
 * a new search starts or the current search is stopped.
 */
function runBatch(prefix, pubKeyHashVersion, batchSize, token) {
  if (!running || token !== runId) {
    return;
  }

  let attempts = 0;

  for (let i = 0; i < batchSize; i++) {
    // Stop as soon as the current run has been invalidated.
    if (!running || token !== runId) {
      return;
    }

    const privateKey = randomPrivateKey();
    attempts++;

    // Compressed public key, matching the existing wallet's address format.
    const publicKey = ecc.pointFromScalar(privateKey, true);

    if (!publicKey) {
      continue;
    }

    const address = p2pkhAddress(publicKey, pubKeyHashVersion);

    if (address.startsWith(prefix)) {
      // Claim the result before notifying the main thread. No subsequent
      // batch belonging to this run should report another winning key.
      running = false;
      runId++;

      self.postMessage({
        type: 'found',
        privateKeyHex: toHex(privateKey),
        address,
        attempts
      });

      return;
    }
  }

  if (!running || token !== runId) {
    return;
  }

  // Report the number of candidates processed in this batch.
  // wallet-app.js accumulates this value across workers.
  self.postMessage({
    type: 'progress',
    attempts
  });

  // Yield to the worker event loop so stop/start messages can be processed.
  if (running && token === runId) {
    setTimeout(() => {
      runBatch(prefix, pubKeyHashVersion, batchSize, token);
    }, 0);
  }
}

self.onmessage = (event) => {
  const message = event.data;

  if (!message || typeof message.type !== 'string') {
    return;
  }

  if (message.type === 'stop') {
    running = false;
    runId++;
    return;
  }

  if (message.type !== 'start') {
    return;
  }

  // Invalidate any previous search and any scheduled batch.
  running = false;
  const token = ++runId;

  const prefix = message.prefix;
  const version = message.pubKeyHashVersion;

  // Do not begin a search with malformed parameters.
  if (
    typeof prefix !== 'string' ||
    prefix.length === 0 ||
    !Number.isInteger(version) ||
    version < 0 ||
    version > 255
  ) {
    return;
  }

  const batchSize = normaliseBatchSize(message.batchSize);

  running = true;
  runBatch(prefix, version, batchSize, token);
};
