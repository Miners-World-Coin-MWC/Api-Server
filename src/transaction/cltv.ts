
import { CLTV, MWC_NETWORK } from "../config/network.js";
import { bytesToHex, hexToBytes } from "../wallet/encoding.js";

export type BitcoinJsLike = {
  script?: {
    number: {
      encode(value: number): Uint8Array;
    };
  };
};

export function assertValidUnlockTime(unlockTime: number): void {
  if (!Number.isSafeInteger(unlockTime) || unlockTime < 0) {
    throw new Error("unlockTime must be a non-negative safe integer.");
  }
}

export function createCltvRedeemScript(
  bitcoin: BitcoinJsLike,
  unlockTime: number,
  publicKeyHex: string
): string {
  assertValidUnlockTime(unlockTime);

  if (!/^(02|03)[0-9a-fA-F]{64}$/.test(publicKeyHex)) {
    throw new Error(
      "CLTV currently requires a compressed 33-byte public key."
    );
  }

  if (!bitcoin.script?.number) {
    throw new Error(
      "The supplied bitcoinjs-lib build does not expose script.number."
    );
  }

  const lockBytes = bitcoin.script.number.encode(unlockTime);
  const pubkey = hexToBytes(publicKeyHex);

  // A compressed public key must always be exactly 33 bytes.
  if (pubkey.length !== 33) {
    throw new Error(
      `Invalid compressed public key length: expected 33 bytes, got ${pubkey.length}.`
    );
  }

  /*
   * MWC CLTV redeem script:
   *
   *   <unlock-time>
   *   OP_CHECKLOCKTIMEVERIFY
   *   OP_DROP
   *   <33-byte compressed public key>
   *   OP_CHECKSIG
   *
   * The locktime is minimally encoded and therefore needs its own
   * compact push length. A compressed public key is exactly 33 bytes,
   * so its canonical direct push opcode is 0x21.
   *
   * We construct the script explicitly instead of passing Uint8Array
   * chunks through bitcoinjs-lib's script.compile(), because the
   * vendored bitcoinjs build used by the browser wallet may not treat
   * Uint8Array chunks as pushdata correctly.
   */
  const OP_CHECKLOCKTIMEVERIFY = 0xb1;
  const OP_DROP = 0x75;
  const OP_CHECKSIG = 0xac;
  const OP_PUSHBYTES_33 = 0x21;

  const script = new Uint8Array(
    1 +
    lockBytes.length +
    1 +
    1 +
    1 +
    pubkey.length +
    1
  );

  let offset = 0;

  // Push the minimally encoded CLTV value.
  if (lockBytes.length > 75) {
    throw new Error(
      `Unsupported CLTV locktime encoding length: ${lockBytes.length} bytes.`
    );
  }

  script[offset++] = lockBytes.length;
  script.set(lockBytes, offset);
  offset += lockBytes.length;

  // OP_CHECKLOCKTIMEVERIFY
  script[offset++] = OP_CHECKLOCKTIMEVERIFY;

  // OP_DROP
  script[offset++] = OP_DROP;

  // Push compressed public key (33 bytes).
  script[offset++] = OP_PUSHBYTES_33;
  script.set(pubkey, offset);
  offset += pubkey.length;

  // OP_CHECKSIG
  script[offset++] = OP_CHECKSIG;

  return bytesToHex(script);
}

export function validateCltvSpend(
  unlockTime: number,
  currentTime: number,
  sequence = CLTV.nonFinalSequence
): void {
  assertValidUnlockTime(unlockTime);

  if (currentTime < unlockTime) {
    throw new Error("CLTV output is still locked.");
  }

  if (sequence === 0xffffffff) {
    throw new Error("CLTV input sequence must be non-final.");
  }
}

export const MWC_CLTV_NETWORK = {
  ...MWC_NETWORK,
  scriptHash: MWC_NETWORK.scriptHash
};
