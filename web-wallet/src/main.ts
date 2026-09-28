import { Buffer } from "buffer";
(globalThis as any).Buffer = Buffer;

import {
  mnemonicGenerate,
  masterNodeFromMnemonic,
  walletFromNode,
  walletFromWif,
  randomWallet,
  findVanityWallet,
  validVanityPrefix,
  cltvP2sh,
  buildTransaction,
  signTransaction,
  buildCltvSpend,
  signCltvSpend,
  type Utxo,
  type WalletKey
} from "@mwc/core";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>Miners World Coin Wallet</h1>
  <p>Non-custodial browser wallet. Private keys never leave this browser; everything happens on chain.</p>
  <label>API <input id="api" value="http://localhost:8787"></label><br>

  <h2>1. Wallet</h2>
  <label>Mnemonic <textarea id="mnemonic" rows="3"></textarea></label><br>
  <button id="new">Create mnemonic</button>
  <button id="derive">Derive wallet from mnemonic</button><br>
  <label>Private key (WIF) <input id="wif" autocomplete="off"></label><br>
  <button id="importWif">Import WIF</button>
  <button id="random">Create random wallet</button><br>
  <label>Custom address prefix <input id="prefix" placeholder="9Mw (starts with 9, max 4 chars)"></label>
  <label><input type="checkbox" id="ignoreCase"> ignore case (faster)</label><br>
  <button id="vanity">Generate custom address</button>
  <button id="showKey">Show private key</button>
  <pre id="wallet">No wallet loaded.</pre>
  <hr>

  <h2>2. Balance &amp; send</h2>
  <button id="refresh">Refresh balance</button><br>
  <label>Recipient <input id="recipient"></label><br>
  <label>Amount MWC <input id="amount" inputmode="decimal"></label><br>
  <label>Fee atomic <input id="fee" value="10000"></label><br>
  <button id="send">Build, sign and broadcast</button>
  <pre id="result"></pre>
  <hr>

  <h2>3. Time lock (on chain, your choice)</h2>
  <p>Locks funds in a script only your key can spend, and only after the unlock time.</p>
  <label>Amount to lock (MWC) <input id="lockAmount" inputmode="decimal"></label><br>
  <label>Unlock at <input id="lockWhen" type="datetime-local"></label><br>
  <button id="lock">Lock funds</button>
  <button id="track">Track lock for this date (recover)</button><br>
  <button id="listLocks">Refresh my locks</button>
  <button id="exportLocks">Export lock list</button><br>
  <label>Lock to redeem <select id="lockSelect"></select></label><br>
  <label>Redeem to (blank = my address) <input id="redeemTo"></label><br>
  <button id="redeem">Redeem matured lock</button>
  <pre id="lockResult"></pre>
  <hr>

  <h2>4. Ledger (on chain)</h2>
  <button id="ledger">Show ledger income</button>
  <pre id="ledgerResult"></pre>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const api = () => $<HTMLInputElement>("api").value.replace(/\/+$/, "");
const show = (id: string, v: unknown) => { $(id).textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2); };
const ATOMIC = 100000000;
const toAtomic = (mwc: string) => Math.round(Number(mwc) * ATOMIC);

let current: WalletKey | null = null;
function need(): WalletKey {
  if (!current) throw new Error("Load a wallet first.");
  return current;
}
function setWallet(w: WalletKey) {
  current = w;
  show("wallet", { address: w.address, public_key: w.publicKeyHex, note: "Back up your private key. Nobody can recover it for you." });
}
const guard = (out: string, fn: () => Promise<unknown> | unknown) => async () => {
  try { show(out, await fn()); } catch (e) { show(out, String((e as Error).message ?? e)); }
};

// ---------- wallet ----------
$("new").onclick = () => ($<HTMLTextAreaElement>("mnemonic").value = mnemonicGenerate());

$("derive").onclick = guard("wallet", () => {
  const node = masterNodeFromMnemonic($<HTMLTextAreaElement>("mnemonic").value.trim()).derivePath("m/44'/20'/0'/0/0");
  setWallet(walletFromNode(node));
  return $("wallet").textContent;
});

$("importWif").onclick = guard("wallet", () => {
  setWallet(walletFromWif($<HTMLInputElement>("wif").value));
  $<HTMLInputElement>("wif").value = "";
  return $("wallet").textContent;
});

$("random").onclick = guard("wallet", () => { setWallet(randomWallet()); return $("wallet").textContent; });

$("showKey").onclick = () => {
  if (!current) return show("wallet", "Load a wallet first.");
  if (confirm("Reveal your private key on screen?")) show("wallet", { address: current.address, wif: current.wif });
};

$("vanity").onclick = async () => {
  try {
    const prefix = $<HTMLInputElement>("prefix").value.trim();
    if (!validVanityPrefix(prefix)) throw new Error("Prefix must start with 9, use base58 characters, max 4 characters.");
    const ignoreCase = $<HTMLInputElement>("ignoreCase").checked;
    let attempts = 0;
    // work in small chunks so the page stays responsive
    for (;;) {
      const w = findVanityWallet(prefix, 2000, ignoreCase);
      attempts += 2000;
      if (w) { setWallet(w); show("wallet", { address: w.address, public_key: w.publicKeyHex, attempts, note: "Custom address created. Back up your private key." }); return; }
      show("wallet", `Searching... ${attempts} keys tried`);
      await new Promise(r => setTimeout(r, 0));
    }
  } catch (e) { show("wallet", String((e as Error).message ?? e)); }
};

// ---------- chain helpers ----------
async function fetchUtxos(address: string): Promise<{ utxos: Utxo[]; balance: any }> {
  const res = await fetch(`${api()}/api/balance/${encodeURIComponent(address)}?with_prevtx=1`);
  const balance = await res.json();
  if (!balance.success) throw new Error(balance.error?.message || "Balance lookup failed.");
  const utxos: Utxo[] = balance.data.utxos.map((u: any) => ({
    txid: u.txid ?? u.hash ?? u.tx_hash,
    vout: Number(u.vout ?? u.n ?? u.index),
    value: Number(u.value ?? u.amount ?? u.satoshis),
    scriptPubKeyHex: u.scriptPubKey?.hex ?? u.scriptPubKeyHex ?? u.script ?? "",
    previousTransactionHex: u.previousTransactionHex
  })).filter((u: Utxo) => u.previousTransactionHex);
  return { utxos, balance: balance.data };
}

async function broadcast(rawtx: string): Promise<string> {
  const res = await fetch(`${api()}/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: rawtx })
  });
  return res.text();
}

/** Pay `amount` from the loaded wallet to `toAddress` (any address, including a lock address). */
async function payTo(toAddress: string, amount: number) {
  const w = need();
  const fee = Number($<HTMLInputElement>("fee").value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid amount.");
  if (!Number.isSafeInteger(fee) || fee < 0) throw new Error("Invalid fee.");
  const { utxos } = await fetchUtxos(w.address);
  const selected: Utxo[] = [];
  let total = 0;
  for (const u of utxos) { selected.push(u); total += u.value; if (total >= amount + fee) break; }
  if (total < amount + fee) throw new Error("Insufficient funds or previous transaction hex unavailable.");
  const outputs = [{ address: toAddress, value: amount }];
  const change = total - amount - fee;
  if (change > 0) outputs.push({ address: w.address, value: change });
  const rawtx = signTransaction(buildTransaction(selected, outputs, fee), [w.wif]);
  return { rawtx, fee_atomic: fee, broadcast: await broadcast(rawtx) };
}

// ---------- balance & send ----------
$("refresh").onclick = guard("result", async () => {
  const w = need();
  const { balance } = await fetchUtxos(w.address);
  return { address: w.address, balance_mwc: Number(balance.confirmed_balance_atomic) / ATOMIC, utxos: balance.utxos.length };
});

$("send").onclick = guard("result", async () => {
  const r = await payTo($<HTMLInputElement>("recipient").value.trim(), toAtomic($<HTMLInputElement>("amount").value));
  return { sender: need().address, ...r };
});

// ---------- time locks (stored only in this browser; recoverable from key + unlock time) ----------
interface SavedLock { pubkey: string; unlockTime: number; address: string; redeemScriptHex: string; txid?: string; }
const LOCKS_KEY = "mwc_locks";
const loadLocks = (): SavedLock[] => { try { return JSON.parse(localStorage.getItem(LOCKS_KEY) || "[]"); } catch { return []; } };
function saveLock(l: SavedLock) {
  const all = loadLocks();
  if (!all.some(x => x.address === l.address)) all.push(l);
  localStorage.setItem(LOCKS_KEY, JSON.stringify(all));
  renderLockSelect();
}
const myLocks = () => loadLocks().filter(l => current && l.pubkey === current.publicKeyHex);
function renderLockSelect() {
  $<HTMLSelectElement>("lockSelect").innerHTML = myLocks()
    .sort((a, b) => a.unlockTime - b.unlockTime)
    .map(l => `<option value="${l.unlockTime}">${new Date(l.unlockTime * 1000).toLocaleString()} (${l.address.slice(0, 8)}…)</option>`)
    .join("");
}
function chosenUnlockTime(): number {
  const t = Math.floor(new Date($<HTMLInputElement>("lockWhen").value).getTime() / 1000);
  if (!t) throw new Error("Pick an unlock date/time.");
  return t;
}
function lockFor(unlockTime: number) {
  const w = need();
  return { w, ...cltvP2sh(unlockTime, w.publicKeyHex) };
}

$("lock").onclick = guard("lockResult", async () => {
  const unlockTime = chosenUnlockTime();
  if (unlockTime * 1000 <= Date.now()) throw new Error("Unlock time must be in the future.");
  const { w, address, redeemScriptHex } = lockFor(unlockTime);
  const r = await payTo(address, toAtomic($<HTMLInputElement>("lockAmount").value));
  saveLock({ pubkey: w.publicKeyHex, unlockTime, address, redeemScriptHex });
  return { locked_address: address, unlock_time: unlockTime, unlock_at: new Date(unlockTime * 1000).toISOString(), ...r };
});

$("track").onclick = guard("lockResult", () => {
  const { w, address, redeemScriptHex } = lockFor(chosenUnlockTime());
  saveLock({ pubkey: w.publicKeyHex, unlockTime: chosenUnlockTime(), address, redeemScriptHex });
  return `Tracking lock at ${address}`;
});

$("listLocks").onclick = guard("lockResult", async () => {
  const w = need();
  renderLockSelect();
  const out: unknown[] = [];
  for (const l of myLocks()) {
    const lockType = l.unlockTime >= 500000000 ? "time" : "height";
    const res = await fetch(`${api()}/api/locks/${w.publicKeyHex}?unlock_time=${l.unlockTime}&lock_type=${lockType}`);
    const j = await res.json();
    out.push(j.success ? { unlock_at: new Date(l.unlockTime * 1000).toLocaleString(), address: j.data.address,
      balance_mwc: Number(j.data.balance_atomic) / ATOMIC, spendable_now: j.data.spendable_now } : j.error);
  }
  return out.length ? out : "No locks saved for this key.";
});

$("exportLocks").onclick = () => show("lockResult", JSON.stringify(myLocks(), null, 2));

$("redeem").onclick = guard("lockResult", async () => {
  const w = need();
  const unlockTime = Number($<HTMLSelectElement>("lockSelect").value);
  if (!unlockTime) throw new Error("Select a lock first.");
  const { address, redeemScriptHex } = lockFor(unlockTime);
  const fee = Number($<HTMLInputElement>("fee").value);
  const { utxos } = await fetchUtxos(address);
  const total = utxos.reduce((s, u) => s + u.value, 0);
  if (!utxos.length) throw new Error("Nothing spendable at that lock yet (or previous transaction unavailable).");
  if (total <= fee) throw new Error("Locked amount does not cover the fee.");
  const dest = $<HTMLInputElement>("redeemTo").value.trim() || w.address;
  const rawtx = signCltvSpend(buildCltvSpend(utxos, dest, total - fee, unlockTime, redeemScriptHex), w.wif);
  return { redeemed_atomic: total - fee, to: dest, rawtx, broadcast: await broadcast(rawtx) };
});

// ---------- ledger ----------
$("ledger").onclick = guard("ledgerResult", async () => {
  const j = await (await fetch(`${api()}/api/ledgerincome`)).json();
  if (!j.success) throw new Error(j.error?.message || "Ledger unavailable.");
  const d = j.data;
  return { income_address: d.income_address,
    income_mwc: Number(d.income_atomic) / ATOMIC, allocated_mwc: Number(d.allocated_atomic) / ATOMIC,
    settled_mwc: Number(d.settled_atomic) / ATOMIC, available_mwc: Number(d.available_atomic) / ATOMIC,
    solvent: d.solvent };
});
