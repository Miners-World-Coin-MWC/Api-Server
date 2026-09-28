import { CLTV, MWC_NETWORK } from "../config/network.js";
import { bytesToHex, hexToBytes } from "../wallet/encoding.js";

export type BitcoinJsLike = {
  script?: {
    number: {
      encode(value: number): Uint8Array;
    };
    compile(chunks: Array<Uint8Array | number>): Uint8Array;
    decompile(script: Uint8Array): Array<Uint8Array | number> | null;
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
    throw new Error("CLTV currently requires a compressed 33-byte public key.");
  }

  if (!bitcoin.script?.number || !bitcoin.script.compile) {
    throw new Error("The supplied bitcoinjs-lib build does not expose script.number/compile.");
  }

  const lockBytes = bitcoin.script.number.encode(unlockTime);
  const pubkey = hexToBytes(publicKeyHex);

  const OP_CHECKLOCKTIMEVERIFY = 0xb1;
  const OP_DROP = 0x75;
  const OP_CHECKSIG = 0xac;

  const script = bitcoin.script.compile([
    lockBytes,
    OP_CHECKLOCKTIMEVERIFY,
    OP_DROP,
    pubkey,
    OP_CHECKSIG
  ]);

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
