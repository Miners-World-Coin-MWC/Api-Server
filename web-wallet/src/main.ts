import { Buffer } from "buffer";
(globalThis as any).Buffer = Buffer;

import {
  mnemonicGenerate,
  masterNodeFromMnemonic,
  legacyAddressFromNode,
  cltvP2sh,
  buildTransaction,
  signTransaction,
  type Utxo
} from "@mwc/core";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>Miners World Coin Wallet</h1>
  <p>Non-custodial browser demo. Private keys never leave this browser.</p>
  <label>API <input id="api" value="https://api2.minersworld.org"></label><br>
  <label>Mnemonic <textarea id="mnemonic" rows="3"></textarea></label><br>
  <button id="new">Create mnemonic</button>
  <button id="derive">Derive wallet</button>
  <pre id="wallet"></pre>
  <hr>
  <label>Recipient <input id="recipient"></label><br>
  <label>Amount MWC <input id="amount" inputmode="decimal"></label><br>
  <label>Fee atomic <input id="fee" value="10000"></label><br>
  <button id="send">Build, sign and broadcast</button>
  <pre id="result"></pre>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("new").onclick = () => ($<HTMLTextAreaElement>("mnemonic").value = mnemonicGenerate());

$("derive").onclick = () => {
  const mnemonic = $<HTMLTextAreaElement>("mnemonic").value.trim();
  const node = masterNodeFromMnemonic(mnemonic).derivePath("m/44'/20'/0'/0/0");
  $("wallet").textContent = JSON.stringify({
    legacy_address: legacyAddressFromNode(node),
    public_key: Buffer.from(node.publicKey).toString("hex"),
    note: "Keep the mnemonic/private key offline and never send it to the API."
  }, null, 2);
};

$("send").onclick = async () => {
  const result = $("result");
  try {
    const api = $<HTMLInputElement>("api").value.replace(/\/+$/, "");
    const mnemonic = $<HTMLTextAreaElement>("mnemonic").value.trim();
    const node = masterNodeFromMnemonic(mnemonic).derivePath("m/44'/20'/0'/0/0");
    const sender = legacyAddressFromNode(node);
    const recipient = $<HTMLInputElement>("recipient").value.trim();
    const amount = Math.round(Number($<HTMLInputElement>("amount").value) * 100000000);
    const fee = Number($<HTMLInputElement>("fee").value);

    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid amount.");
    if (!Number.isSafeInteger(fee) || fee < 0) throw new Error("Invalid fee.");

    const balanceResponse = await fetch(`${api}/api/balance/${encodeURIComponent(sender)}?with_prevtx=1`);
    const balance = await balanceResponse.json();
    if (!balance.success) throw new Error(balance.error?.message || "Balance lookup failed.");

    const utxos: Utxo[] = balance.data.utxos.map((u: any) => ({
      txid: u.txid ?? u.hash ?? u.tx_hash,
      vout: Number(u.vout ?? u.n ?? u.index),
      value: Number(u.value ?? u.amount ?? u.satoshis),
      scriptPubKeyHex: u.scriptPubKey?.hex ?? u.scriptPubKeyHex ?? u.script ?? "",
      previousTransactionHex: u.previousTransactionHex
    })).filter((u: Utxo) => u.previousTransactionHex);

    const selected: Utxo[] = [];
    let total = 0;
    for (const u of utxos) {
      selected.push(u);
      total += u.value;
      if (total >= amount + fee) break;
    }
    if (total < amount + fee) throw new Error("Insufficient funds or previous transaction hex unavailable.");

    const outputs = [{ address: recipient, value: amount }];
    const change = total - amount - fee;
    if (change > 0) outputs.push({ address: sender, value: change });

    const psbt = buildTransaction(selected, outputs, fee);
    const wif = node.toWIF();
    const rawtx = signTransaction(psbt, [wif]);

    const broadcast = await fetch(`${api}/broadcast`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawtx })
    });
    const broadcastBody = await broadcast.text();

    result.textContent = JSON.stringify({
      sender,
      amount_atomic: amount,
      fee_atomic: fee,
      rawtx,
      broadcast: broadcastBody
    }, null, 2);
  } catch (e) {
    result.textContent = String(e);
  }
};
