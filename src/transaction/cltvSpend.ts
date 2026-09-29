import { bytesToHex, concatBytes, hexToBytes } from "../wallet/encoding.js";

/**
 * scriptSig for spending a P2SH CLTV lock: <sig> <redeemScript>.
 * Standard P2SH mechanics pop the last item (the redeem script), verify its hash matches the
 * P2SH output, then execute it against whatever is left on the stack (here, just the
 * signature) - see cltv.ts for the corresponding redeem script and the full execution trace.
 *
 * Built by hand instead of via bitcoinjs-lib's script.compile(), for the same reason
 * createCltvRedeemScript() is: the vendored bitcoinjs build used by the browser wallet may not
 * treat Uint8Array chunks as pushdata correctly for non-standard scripts.
 */
function pushData(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 76) {
    return concatBytes(new Uint8Array([bytes.length]), bytes);
  }
  if (bytes.length <= 0xff) {
    // OP_PUSHDATA1 - not expected in practice (signatures and this redeem script are both
    // well under 76 bytes) but included so this never silently produces a malformed script.
    return concatBytes(new Uint8Array([0x4c, bytes.length]), bytes);
  }
  throw new Error(`Pushdata too large for a CLTV scriptSig: ${bytes.length} bytes.`);
}

export function buildCltvScriptSig(derSignatureHex: string, redeemScriptHex: string): string {
  const sig = hexToBytes(derSignatureHex);
  const redeem = hexToBytes(redeemScriptHex);
  return bytesToHex(concatBytes(pushData(sig), pushData(redeem)));
}
