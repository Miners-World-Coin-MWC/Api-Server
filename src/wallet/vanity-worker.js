// Runs in a Web Worker. Deliberately does NOT import the bitcoinJS-lib.js UMD bundle, since
// that script may assume `window` exists (it won't, inside a worker). Only tiny-secp256k1
// (already used on the main thread for BIP32) and pure-JS hashing are needed to search for a
// vanity address; the winning private key is handed back to the main thread, which builds the
// actual WIF/ECPair there using the real bitcoinjs library.
import * as ecc from 'tiny-secp256k1';
import { p2pkhAddress } from './address-encode.js';

let running = false;

function randomPrivateKey() {
  let key;
  do { key = crypto.getRandomValues(new Uint8Array(32)); } while (!ecc.isPrivate(key));
  return key;
}
function toHex(bytes) { return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(''); }

function runBatch(prefix, pubKeyHashVersion, batchSize) {
  if (!running) return;
  let attempts = 0;
  for (let i = 0; i < batchSize; i++) {
    const priv = randomPrivateKey();
    const pub = ecc.pointFromScalar(priv, true);
    const address = p2pkhAddress(pub, pubKeyHashVersion);
    attempts++;
    if (address.startsWith(prefix)) {
      running = false;
      self.postMessage({ type: 'found', privateKeyHex: toHex(priv), address, attempts });
      return;
    }
  }
  self.postMessage({ type: 'progress', attempts });
  if (running) setTimeout(() => runBatch(prefix, pubKeyHashVersion, batchSize), 0);
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    running = true;
    runBatch(msg.prefix, msg.pubKeyHashVersion, msg.batchSize || 3000);
  } else if (msg.type === 'stop') {
    running = false;
  }
};
