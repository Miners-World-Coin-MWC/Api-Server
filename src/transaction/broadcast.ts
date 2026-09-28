import { MWCAPIClient } from "../api/client.js";

export async function broadcastSignedTransaction(
  api: MWCAPIClient,
  rawSignedTransactionHex: string
): Promise<string> {
  if (!/^[0-9a-fA-F]+$/.test(rawSignedTransactionHex)) {
    throw new Error("Raw transaction must be hexadecimal.");
  }

  return api.broadcast(rawSignedTransactionHex);
}
