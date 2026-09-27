import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";

/**
 * Server-side CLTV lock derivation used only to VERIFY a claim, never to sign or move funds.
 *
 * Deliberately does NOT import tiny-secp256k1 / call bitcoin.initEccLib(). P2SH address
 * derivation is pure hashing (script -> HASH160 -> base58check), it needs no elliptic-curve
 * operations, so we avoid pulling a WASM dependency into the Worker bundle just to recompute
 * an address. (The browser wallet in web-wallet/ still uses the full mwc.ts + tiny-secp256k1
 * for actually signing transactions, where a real EC library is required.)
 */
export const MWC_NETWORK: bitcoin.Network = {
  messagePrefix: "\x18MinersWorldCoin Signed Message:\n",
  bech32: "mwc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 20,
  scriptHash: 10,
  wif: 123
};

export function cltvRedeemScript(unlockTime: number, publicKeyHex: string): Buffer {
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) {
    throw new Error("unlockTime must be an unsigned 32-bit integer");
  }
  const pubkey = Buffer.from(publicKeyHex, "hex");
  if (pubkey.length !== 33 && pubkey.length !== 65) throw new Error("Public key must be 33 or 65 bytes");
  return bitcoin.script.compile([
    bitcoin.script.number.encode(unlockTime),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    pubkey,
    bitcoin.opcodes.OP_CHECKSIG
  ]);
}

export function cltvP2sh(unlockTime: number, publicKeyHex: string): { redeemScriptHex: string; address: string; unlockTime: number } {
  const redeem = cltvRedeemScript(unlockTime, publicKeyHex);
  const address = bitcoin.payments.p2sh({ redeem: { output: redeem }, network: MWC_NETWORK }).address!;
  return { redeemScriptHex: redeem.toString("hex"), address, unlockTime };
}
