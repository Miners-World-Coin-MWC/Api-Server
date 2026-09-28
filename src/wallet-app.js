import { Buffer } from 'buffer';
window.Buffer = Buffer; // bip39/bip32 expect a global Buffer; Vite doesn't polyfill Node globals on its own

import * as bip39 from 'bip39';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import { MWC_NETWORK, MWC_CHAIN, CLTV } from './config/network.js';
import { MWCWalletAPI } from './api/index.js';
import { createCltvRedeemScript } from './transaction/cltv.js';

const bip32 = BIP32Factory(ecc);
const api = new MWCWalletAPI();
const bitcoin = window.bitcoin;
if (!bitcoin) throw new Error('MWC bitcoinJS library was not loaded.');

const $ = (id) => document.getElementById(id);
const out = $('output');
let active = null;
let currentUtxos = [];
let lastCltv = null; // {script, address}
let vanityRunning = false;

function net() { return MWC_NETWORK; }
function keyFromWif(wif) { return bitcoin.ECPair.fromWIF(wif.trim(), net()); }
function addressFromKey(key) { return bitcoin.payments.p2pkh({ pubkey: key.publicKey, network: net() }).address; }
function hex(b) { return Buffer.from(b).toString('hex'); }
function formatMwc(v) { return (Number(v) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }); }
function log(v) { out.textContent = (typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n\n' + out.textContent; }

// ---------- toasts ----------
function toast(message, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'bad' ? ' bad' : kind === 'good' ? ' good' : '');
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
function guard(fn, okMsg) {
  return async (...args) => {
    try {
      const r = await fn(...args);
      if (okMsg) toast(okMsg, 'good');
      return r;
    } catch (e) {
      toast(e.message || String(e), 'bad');
      log(e.message || String(e));
    }
  };
}

// ---------- tabs ----------
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
  document.querySelectorAll('section.tab').forEach((s) => s.classList.toggle('active', s.dataset.tab === btn.dataset.tab));
});

// copy-to-clipboard on any button[data-copy] or the header chip
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-copy]');
  if (!btn) return;
  const src = $(btn.dataset.copy);
  const text = src.value !== undefined ? src.value : src.textContent;
  if (!text || text === '—') return;
  navigator.clipboard?.writeText(text).then(() => toast('Copied', 'good')).catch(() => {});
});
$('chipCopy').onclick = () => {
  if (!active) return;
  navigator.clipboard?.writeText(active.address).then(() => toast('Address copied', 'good')).catch(() => {});
};

// ---------- wallet state ----------
function walletFromKey(key, extra = {}) {
  active = { key, wif: key.toWIF(), address: addressFromKey(key), ...extra };
  refreshWallet();
  return active;
}
function refreshWallet() {
  if (!active) return;
  $('walletWarning').style.display = 'none';
  $('walletDetails').style.display = '';
  $('walletAddress').textContent = active.address;
  $('walletWif').textContent = 'hidden';
  $('walletWif').dataset.value = active.wif;
  $('walletPub').textContent = hex(active.key.publicKey);
  $('walletPath').textContent = active.path || 'single-key';
  $('watchAddress').value = active.address;
  $('lockPub').value = hex(active.key.publicKey);

  $('walletChip').classList.add('active');
  $('chipAddress').textContent = active.address.slice(0, 10) + '…' + active.address.slice(-6);
  $('chipBalance').textContent = '';
}
$('toggleWif').onclick = () => {
  const el = $('walletWif');
  el.textContent = el.textContent === 'hidden' ? el.dataset.value : 'hidden';
};

// ---------- create / import ----------
$('createWallet').onclick = guard(() => {
  const mnemonic = bip39.generateMnemonic(256);
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const path = `m/44'/0'/0'/0/0`;
  const child = bip32.fromSeed(seed, net()).derivePath(path);
  const key = bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey), { network: net() });
  walletFromKey(key, { mnemonic, path });
  $('mnemonic').value = active.mnemonic;
  log({ created: true, address: active.address, mnemonic: active.mnemonic, wif: active.wif, warning: 'Back up the mnemonic/private key offline before using funds.' });
}, 'Wallet created — back up your mnemonic!');

$('importWif').onclick = guard(() => {
  walletFromKey(keyFromWif($('wif').value));
  log({ imported: 'WIF', address: active.address });
}, 'WIF imported');

$('importPrivate').onclick = guard(() => {
  const h = $('privateHex').value.trim().replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw Error('Private key must be 32-byte hex.');
  walletFromKey(bitcoin.ECPair.fromPrivateKey(Buffer.from(h, 'hex'), { network: net() }));
  log({ imported: 'private key', address: active.address });
}, 'Private key imported');

$('importMnemonic').onclick = guard(() => {
  const phrase = $('mnemonic').value.trim();
  if (!bip39.validateMnemonic(phrase)) throw Error('Invalid BIP39 mnemonic.');
  const seed = bip39.mnemonicToSeedSync(phrase);
  const root = bip32.fromSeed(seed, net());
  const path = `m/44'/0'/0'/0/0`;
  const child = root.derivePath(path);
  const key = bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey), { network: net() });
  walletFromKey(key, { mnemonic: phrase, path });
  log({ imported: 'BIP39', address: active.address, path });
}, 'Mnemonic imported');

$('importXprv').onclick = guard(() => {
  const x = $('xprv').value.trim();
  const root = bip32.fromBase58(x, net());
  const path = `m/44'/0'/0'/0/0`;
  const child = root.derivePath(path);
  const key = bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey), { network: net() });
  walletFromKey(key, { path });
  log({ imported: 'xprv', address: active.address });
}, 'xprv imported');

$('importXpub').onclick = guard(() => {
  const x = $('xpub').value.trim();
  const root = bip32.fromBase58(x, net());
  const child = root.derive(0).derive(0);
  const address = bitcoin.payments.p2pkh({ pubkey: Buffer.from(child.publicKey), network: net() }).address;
  $('watchAddress').value = address;
  log({ imported: 'xpub', watchOnly: true, address });
  document.querySelector('nav.tabs button[data-tab="balance"]').click();
}, 'Watching xpub address');

// ---------- balance / history ----------
$('checkBalance').onclick = guard(async () => {
  const a = ($('watchAddress').value || active?.address || '').trim();
  if (!a) throw Error('Enter an address or import/create a wallet.');
  const r = await api.balance(a);
  currentUtxos = r.confirmed.utxos || [];
  $('sendAddress') && ($('sendAddress').value = a);
  $('balanceStats').style.display = '';
  $('statBalance').textContent = formatMwc(r.confirmed.balance) + ' MWC';
  $('statReceived').textContent = formatMwc(r.confirmed.received) + ' MWC';
  $('statUtxos').textContent = currentUtxos.length;
  $('statMempool').textContent = (r.mempool?.txcount ?? r.mempool?.tx?.length ?? 0);
  if (active && a === active.address) $('chipBalance').textContent = formatMwc(r.confirmed.balance) + ' MWC';
  log({ address: a, balanceMwc: formatMwc(r.confirmed.balance), receivedMwc: formatMwc(r.confirmed.received), utxos: currentUtxos, mempool: r.mempool });
});

$('history').onclick = guard(async () => {
  const a = ($('watchAddress').value || active?.address || '').trim();
  if (!a) throw Error('Enter an address or import/create a wallet.');
  const items = await api.history(a);
  const list = $('historyList');
  list.innerHTML = '';
  if (!items.length) list.innerHTML = '<div class="item">No transactions found.</div>';
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'item';
    const confirmed = (it.confirmations || 0) > 0;
    div.innerHTML = `<div class="top"><span class="mono">${it.txid.slice(0, 18)}…</span><span class="badge ${confirmed ? 'good' : 'wait'}">${confirmed ? it.confirmations + ' conf' : 'unconfirmed'}</span></div>`;
    list.appendChild(div);
  }
  log(items);
});

// ---------- send ----------
$('send').onclick = guard(() => {
  if (!active) throw Error('Import/create a signing wallet first.');
  const to = $('sendTo').value.trim();
  const amount = Math.round(Number($('sendAmount').value) * 1e8);
  const fee = Math.round(Number($('sendFee').value || 0.01) * 1e8);
  if (!to) throw Error('Recipient is required.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Invalid amount.');
  if (!Number.isSafeInteger(fee) || fee < 0) throw Error('Invalid fee.');
  const sorted = [...currentUtxos].sort((a, b) => b.value - a.value);
  let selected = [], total = 0;
  for (const u of sorted) { selected.push(u); total += u.value; if (total >= amount + fee) break; }
  if (total < amount + fee) throw Error('Insufficient confirmed UTXOs. Refresh balance first.');
  const txb = new bitcoin.TransactionBuilder(net());
  for (const u of selected) txb.addInput(u.txid, u.index);
  txb.addOutput(to, amount);
  const change = total - amount - fee;
  if (change > 0) txb.addOutput(active.address, change);
  selected.forEach((u, i) => txb.sign(i, active.key));
  const raw = txb.build().toHex();
  $('rawTx').value = raw;
  $('sendStats').style.display = '';
  $('sendStatTo').textContent = to;
  $('sendStatAmount').textContent = formatMwc(amount) + ' MWC';
  $('sendStatFee').textContent = formatMwc(fee) + ' MWC';
  $('sendStatChange').textContent = formatMwc(change) + ' MWC';
  log({ unsignedIntent: { to, amountMwc: formatMwc(amount), feeMwc: formatMwc(fee), changeMwc: formatMwc(change) }, raw });
}, 'Transaction signed — review before broadcasting');

$('broadcast').onclick = guard(async () => {
  const raw = $('rawTx').value.trim();
  if (!raw) throw Error('No raw transaction.');
  if (!confirm('Broadcast this signed transaction to the MWC network?')) return;
  const r = await api.broadcast(raw);
  log(r);
  return r;
}, 'Broadcast');

// ---------- vanity ----------
// ---------- vanity ----------
const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]*$/;
function normalizedVanityInput() {
  let typed = $('vanityPrefix').value.trim();
  if (typed.startsWith('9')) typed = typed.slice(1); // the mandatory leading 9 doesn't count against the limit
  return typed;
}
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}
const ASSUMED_ATTEMPTS_PER_SECOND = 60000; // rough single-threaded baseline until we measure the real rate
function updateVanityDifficulty() {
  const typed = normalizedVanityInput();
  const el = $('vanityDifficulty');
  if (!typed) { el.textContent = 'Target: 9 — type a prefix to see the expected number of attempts.'; return; }
  if (!BASE58_RE.test(typed)) { el.textContent = 'Contains characters that are not valid Base58.'; return; }
  const expected = Math.pow(58, typed.length);
  const eta = formatDuration(expected / ASSUMED_ATTEMPTS_PER_SECOND);
  el.textContent = `Target: 9${typed} — average of ~${expected.toLocaleString(undefined, { maximumFractionDigits: 0 })} attempts, roughly ${eta} on this device (varies with luck and CPU speed).`;
}
$('vanityPrefix').addEventListener('input', updateVanityDifficulty);
updateVanityDifficulty();

$('vanity').onclick = () => {
  const typed = normalizedVanityInput();
  const maxLen = CLTV.maxVanityPrefixLength;
  if (!typed) { toast('Type at least one character after the 9.', 'bad'); return; }
  if (typed.length > maxLen) { toast(`At most ${maxLen} characters after the 9.`, 'bad'); return; }
  if (!BASE58_RE.test(typed)) { toast('Prefix contains characters that are not valid Base58.', 'bad'); return; }
  const wanted = '9' + typed;
  $('vanityPrefix').value = typed;
  const expected = Math.pow(58, typed.length);
  vanityRunning = true;
  $('vanity').disabled = true;
  $('vanityStop').style.display = '';
  $('vanityBar').style.display = '';
  $('vanityResult').style.display = 'none';
  let attempts = 0;
  const start = performance.now();
  (function step() {
    if (!vanityRunning) { finishVanity(); return; }
    for (let i = 0; i < 400; i++) {
      const key = bitcoin.ECPair.makeRandom({ network: net() });
      attempts++;
      const a = addressFromKey(key);
      if (a.startsWith(wanted)) {
        walletFromKey(key);
        const seconds = ((performance.now() - start) / 1000).toFixed(2);
        $('vanityResult').style.display = '';
        $('vanityResult').innerHTML = `<div><span class="k">Address</span><span class="v mono">${a}</span></div><div><span class="k">Attempts</span><span class="v">${attempts.toLocaleString()}</span></div><div><span class="k">Time</span><span class="v">${seconds}s</span></div>`;
        log({ vanity: true, prefix: wanted, address: a, wif: key.toWIF(), attempts, seconds: Number(seconds) });
        toast('Custom address found: ' + a, 'good');
        finishVanity();
        return;
      }
    }
    const elapsed = (performance.now() - start) / 1000;
    const rate = attempts / elapsed;
    $('vanityStatus').textContent = `${attempts.toLocaleString()} attempts (~${(attempts / expected * 100).toFixed(1)}% of the average) · ${elapsed.toFixed(1)}s elapsed · ${Math.round(rate).toLocaleString()} attempts/sec · est. ${formatDuration(expected / rate)} on average at this rate`;
    setTimeout(step, 0);
  })();
};
function finishVanity() {
  vanityRunning = false;
  $('vanity').disabled = false;
  $('vanityStop').style.display = 'none';
  $('vanityBar').style.display = 'none';
}
$('vanityStop').onclick = () => { vanityRunning = false; toast('Stopped'); };

// ---------- CLTV lock ----------
$('makeCltv').onclick = guard(() => {
  const t = Number($('unlockTime').value);
  const pub = $('lockPub').value.trim() || hex(active?.key?.publicKey || []);
  if (!pub) throw Error('Provide a public key or load a wallet.');
  const script = createCltvRedeemScript(bitcoin, t, pub);
  const redeem = Buffer.from(script, 'hex');
  const p2sh = bitcoin.payments.p2sh({ redeem: { output: redeem }, network: net() });
  lastCltv = { script, address: p2sh.address };
  $('cltvDetails').style.display = '';
  $('cltvScriptOut').textContent = script;
  $('cltvAddressOut').textContent = p2sh.address;
  log({ unlockTime: t, pubkey: pub, redeemScript: script, p2shAddress: p2sh.address, template: '<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG' });
}, 'Lock address created');

$('lockFunds').onclick = guard(() => {
  if (!active) throw Error('Create/import wallet first.');
  if (!lastCltv) throw Error('Create a lock address first.');
  const amount = Math.round(Number($('lockAmount').value) * 1e8);
  const fee = Math.round(Number($('lockFee').value || 0.01) * 1e8);
  const unlock = Number($('unlockTime').value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Error('Invalid lock amount.');
  const sorted = [...currentUtxos].sort((a, b) => b.value - a.value);
  let selected = [], total = 0;
  for (const u of sorted) { selected.push(u); total += u.value; if (total >= amount + fee) break; }
  if (total < amount + fee) throw Error('Insufficient UTXOs. Refresh balance.');
  const txb = new bitcoin.TransactionBuilder(net());
  for (const u of selected) txb.addInput(u.txid, u.index);
  txb.addOutput(lastCltv.address, amount);
  const change = total - amount - fee;
  if (change > 0) txb.addOutput(active.address, change);
  selected.forEach((u, i) => txb.sign(i, active.key));
  $('rawTx').value = txb.build().toHex();
  log({ lockTransaction: true, unlockTime: unlock, p2shAddress: lastCltv.address, amountMwc: formatMwc(amount), feeMwc: formatMwc(fee), raw: $('rawTx').value });
  toast('Lock transaction signed — broadcast it from the Send tab');
  document.querySelector('nav.tabs button[data-tab="send"]').click();
});

// ---------- backup ----------
$('exportBackup').onclick = guard(async () => {
  if (!active) throw Error('No wallet loaded.');
  const password = $('backupPassword').value;
  if (password.length < 12) throw Error('Use a backup password of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const payload = JSON.stringify({ version: 1, wif: active.wif, mnemonic: active.mnemonic || null, path: active.path || null, address: active.address });
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
  const b64 = (x) => btoa(String.fromCharCode(...new Uint8Array(x)));
  const blob = JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(ct) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([blob], { type: 'application/json' }));
  a.download = 'mwc-wallet-backup.json';
  a.click();
}, 'Encrypted backup downloaded');

// ---------- node / API ----------
function bindNode(id, fn) { $(id).onclick = guard(async () => { const r = await fn(); $('nodeOut').textContent = JSON.stringify(r, null, 2); log(r); return r; }); }
bindNode('node', () => api.nodechain());
bindNode('params', () => api.paramschain());
bindNode('fee', () => api.fee());
bindNode('minimum', () => api.minimum());
bindNode('healthsync', () => api.healthsync());
bindNode('ledgerincome', () => api.ledgerincome());

$('clearLog').onclick = () => { out.textContent = ''; };

log({ ready: true, network: 'MWC', api: 'https://api.minersworld.org', parameters: { pubKeyHash: 20, scriptHash: 10, wif: 123, bip32Public: '0488b21e', bip32Private: '0488ade4', bech32: 'mwc' } });
