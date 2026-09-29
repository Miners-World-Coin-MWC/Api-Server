// Pure JS, no `window` dependency anywhere - safe to import from a Web Worker as well as the
// main thread. Used by the vanity-address worker so the hot search loop never has to touch
// the bitcoinJS-lib.js UMD bundle (which may assume `window` exists).
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function hash160(bytes) {
  return ripemd160(sha256(bytes));
}

export function base58checkEncode(versionByte, payload) {
  const data = new Uint8Array(1 + payload.length);
  data[0] = versionByte;
  data.set(payload, 1);
  const checksum = sha256(sha256(data)).slice(0, 4);
  const full = new Uint8Array(data.length + 4);
  full.set(data);
  full.set(checksum, data.length);

  let zeros = 0;
  while (zeros < full.length && full[zeros] === 0) zeros++;

  let num = 0n;
  for (const b of full) num = (num << 8n) | BigInt(b);

  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

export function p2pkhAddress(pubkeyBytes, pubKeyHashVersion) {
  return base58checkEncode(pubKeyHashVersion, hash160(pubkeyBytes));
}
