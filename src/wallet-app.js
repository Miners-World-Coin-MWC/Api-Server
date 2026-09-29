import { Buffer } from 'buffer';
window.Buffer = Buffer; // bip39/bip32 expect a global Buffer; Vite doesn't polyfill Node globals on its own

import * as bip39 from 'bip39';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import { MWC_NETWORK, MWC_CHAIN, CLTV } from './config/network.js';
import { MWCWalletAPI } from './api/index.js';
import { createCltvRedeemScript } from './transaction/cltv.js';
import { buildCltvScriptSig } from './transaction/cltvSpend.js';

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
  el.style.cursor = 'pointer';
  el.title = 'Click to dismiss';
  el.onclick = () => el.remove();
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 4200);
}
// MwcApiError (thrown by MWCAPIClient) carries the real upstream body in `.details`, but
// the message alone is a generic "MWC API returned an error" — surface the actual reason.
function describeError(e) {
  if (!e) return 'Unknown error';
  let msg = e.message || String(e);
  const d = e.details;
  if (d && typeof d === 'object') {
    const reason = 'error' in d ? d.error : d;
    if (reason !== undefined && reason !== null) {
      msg += ': ' + (typeof reason === 'string' ? reason : JSON.stringify(reason));
    }
  } else if (typeof d === 'string' && d) {
    msg += ': ' + d;
  }
  return msg;
}
function guard(fn, okMsg) {
  return async (...args) => {
    try {
      const r = await fn(...args);
      if (okMsg) toast(okMsg, 'good');
      return r;
    } catch (e) {
      const msg = describeError(e);
      toast(msg, 'bad');
      log(msg);
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
  renderLocks().catch(() => {});
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

// ---------- vanity (parallel across CPU cores via Web Workers, with a safe fallback) ----------
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
const ASSUMED_ATTEMPTS_PER_SECOND = 60000; // rough single-core baseline until we measure the real rate
function updateVanityDifficulty() {
  const typed = normalizedVanityInput();
  const el = $('vanityDifficulty');
  if (!typed) { el.textContent = 'Target: 9 — type a prefix to see the expected number of attempts.'; return; }
  if (!BASE58_RE.test(typed)) { el.textContent = 'Contains characters that are not valid Base58.'; return; }
  const expected = Math.pow(58, typed.length);
  const threads = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
  const eta = formatDuration(expected / (ASSUMED_ATTEMPTS_PER_SECOND * threads));
  el.textContent = `Target: 9${typed} — average of ~${expected.toLocaleString(undefined, { maximumFractionDigits: 0 })} attempts, roughly ${eta} on this device across ${threads} threads (varies with luck and CPU speed).`;
}
$('vanityPrefix').addEventListener('input', updateVanityDifficulty);
updateVanityDifficulty();

let vanityWorkers = [];
function stopVanityWorkers() { vanityWorkers.forEach((w) => w.terminate()); vanityWorkers = []; }
function finishVanity() {
  vanityRunning = false;
  stopVanityWorkers();
  $('vanity').disabled = false;
  $('vanityStop').style.display = 'none';
  $('vanityBar').style.display = 'none';
}
$('vanityStop').onclick = () => { finishVanity(); toast('Stopped'); };

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

  const start = performance.now();
  let attempts = 0;
  let sawAnyResponse = false;

  function showFound(address, wif) {
    if (!vanityRunning) return;
    const key = keyFromWif(wif);
    walletFromKey(key);
    const seconds = ((performance.now() - start) / 1000).toFixed(2);
    $('vanityResult').style.display = '';
    $('vanityResult').innerHTML = `<div><span class="k">Address</span><span class="v mono">${address}</span></div><div><span class="k">Attempts</span><span class="v">${attempts.toLocaleString()}</span></div><div><span class="k">Time</span><span class="v">${seconds}s</span></div>`;
    log({ vanity: true, prefix: wanted, address, wif, attempts, seconds: Number(seconds) });
    toast('Custom address found: ' + address, 'good');
    finishVanity();
  }
  function updateStatus(threadCount) {
    const elapsed = (performance.now() - start) / 1000;
    const rate = attempts / elapsed;
    $('vanityStatus').textContent = `${attempts.toLocaleString()} attempts (~${(attempts / expected * 100).toFixed(1)}% of the average) · ${elapsed.toFixed(1)}s elapsed · ${Math.round(rate).toLocaleString()} attempts/sec across ${threadCount} thread${threadCount === 1 ? '' : 's'} · est. ${formatDuration(expected / rate)} on average at this rate`;
  }

  // --- single-threaded fallback (identical to the original implementation) ---
  function runFallback() {
    (function step() {
      if (!vanityRunning) return;
      for (let i = 0; i < 400; i++) {
        const key = bitcoin.ECPair.makeRandom({ network: net() });
        attempts++;
        const a = addressFromKey(key);
        if (a.startsWith(wanted)) { showFound(a, key.toWIF()); return; }
      }
      updateStatus(1);
      setTimeout(step, 0);
    })();
  }

  // --- parallel Web Worker search ---
  let usedFallback = false;
  function fallbackIfWorkersNeverRespond() {
    setTimeout(() => {
      if (!vanityRunning || sawAnyResponse) return;
      stopVanityWorkers();
      usedFallback = true;
      toast('Workers unavailable in this environment - falling back to a single-threaded search.', 'info');
      runFallback();
    }, 2500);
  }

  try {
    const threads = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4));
    for (let i = 0; i < threads; i++) {
      const worker = new Worker(new URL('./wallet/vanity-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (usedFallback) return; // a stray message from a worker we already gave up on
        sawAnyResponse = true;
        const msg = e.data;
        attempts += msg.attempts;
        if (msg.type === 'found') {
          const priv = Buffer.from(msg.privateKeyHex, 'hex');
          const key = bitcoin.ECPair.fromPrivateKey(priv, { network: net() });
          vanityRunning = false; // stop other workers from also reporting "found"
          showFound(msg.address, key.toWIF());
        } else {
          updateStatus(vanityWorkers.length);
        }
      };
      worker.onerror = () => { /* handled by fallbackIfWorkersNeverRespond below */ };
      worker.postMessage({ type: 'start', prefix: wanted, pubKeyHashVersion: net().pubKeyHash, batchSize: 3000 });
      vanityWorkers.push(worker);
    }
    fallbackIfWorkersNeverRespond();
  } catch (err) {
    stopVanityWorkers();
    runFallback();
  }
};

// ---------- CLTV lock ----------
function updateUnlockPreview() {
  const t = Number($('unlockTime').value);
  const el = $('unlockPreview');
  if (!t) { el.textContent = ''; return; }
  if (t >= CLTV.timeThreshold) {
    el.textContent = `Unlocks: ${new Date(t * 1000).toLocaleString()} (${Math.max(0, Math.round((t - Date.now() / 1000) / 86400))} days from now)`;
  } else {
    el.textContent = `Interpreted as a block height (below ${CLTV.timeThreshold.toLocaleString()}), not a date.`;
  }
}
$('unlockTime').addEventListener('input', updateUnlockPreview);
$('durationPresets').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-days]');
  if (!btn) return;
  document.querySelectorAll('#durationPresets button').forEach((b) => b.classList.toggle('alt', b !== btn));
  const days = Number(btn.dataset.days);
  $('unlockTime').value = Math.floor(Date.now() / 1000) + days * 86400;
  updateUnlockPreview();
});

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
  trackLock({ pubkey: pub.toLowerCase(), unlockTime: t, script, address: p2sh.address, createdAt: Math.floor(Date.now() / 1000) });
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
  trackLock({ pubkey: hex(active.key.publicKey), unlockTime: unlock, script: lastCltv.script, address: lastCltv.address, createdAt: Math.floor(Date.now() / 1000) });
  log({ lockTransaction: true, unlockTime: unlock, p2shAddress: lastCltv.address, amountMwc: formatMwc(amount), feeMwc: formatMwc(fee), raw: $('rawTx').value });
  toast('Lock transaction signed — broadcast it from the Send tab, then Refresh my locks once confirmed');
  document.querySelector('nav.tabs button[data-tab="send"]').click();
});

// ---------- my locks: local tracking, live status, and redeeming a matured lock ----------
const LOCKS_KEY = 'mwc_locks_v1';
function loadLocks() { try { return JSON.parse(localStorage.getItem(LOCKS_KEY) || '[]'); } catch { return []; } }
function saveLocks(list) { localStorage.setItem(LOCKS_KEY, JSON.stringify(list)); }
function trackLock(lock) {
  const list = loadLocks();
  if (!list.some((l) => l.address === lock.address)) { list.push(lock); saveLocks(list); }
  if (active && lock.pubkey === hex(active.key.publicKey)) renderLocks().catch(() => {});
}

let lastLockRows = [];
async function renderLocks() {
  const container = $('myLocksList');
  if (!active) { container.innerHTML = '<div class="item">Load a wallet, then refresh, to see its locks.</div>'; return; }
  const myPub = hex(active.key.publicKey);
  const list = loadLocks().filter((l) => l.pubkey === myPub);
  if (!list.length) { container.innerHTML = '<div class="item">No tracked locks yet for this wallet — create one above.</div>'; lastLockRows = []; return; }
  container.innerHTML = '<div class="item">Checking lock status on chain…</div>';
  let height = null;
  try { height = (await api.nodechain()).height; } catch { /* height stays null; height-based locks just show as unknown */ }
  const nowSec = Math.floor(Date.now() / 1000);
  lastLockRows = await Promise.all(list.map(async (lock) => {
    let balanceAtomic = 0, utxos = [], checkFailed = false;
    try {
      const b = await api.balance(lock.address);
      balanceAtomic = Number(b.confirmed.balance);
      utxos = b.confirmed.utxos || [];
    } catch { checkFailed = true; }
    const isTimeLock = lock.unlockTime >= CLTV.timeThreshold;
    const reached = isTimeLock ? nowSec >= lock.unlockTime : (height !== null && height >= lock.unlockTime);
    return { lock, balanceAtomic, utxos, isTimeLock, reached, checkFailed };
  }));
  renderLockRows();
}
function renderLockRows() {
  const container = $('myLocksList');
  const nowSec = Math.floor(Date.now() / 1000);
  container.innerHTML = '';
  for (const row of lastLockRows) {
    const canRedeem = row.reached && row.balanceAtomic > 0 && row.utxos.length > 0;
    let statusHtml, whenHtml;
    if (row.checkFailed) {
      statusHtml = '<span class="badge">Could not check</span>';
    } else if (row.balanceAtomic <= 0) {
      statusHtml = '<span class="badge">Not funded yet</span>';
    } else if (canRedeem) {
      statusHtml = `<span class="badge good">Unlocked — ${formatMwc(row.balanceAtomic)} MWC</span>`;
    } else if (row.isTimeLock) {
      statusHtml = `<span class="badge wait" data-countdown="${row.lock.address}">Locked — ${formatDuration(Math.max(0, row.lock.unlockTime - nowSec))} left</span>`;
    } else {
      const blocksLeft = height === null ? '?' : Math.max(0, row.lock.unlockTime - height);
      statusHtml = `<span class="badge wait">Locked — ${blocksLeft} blocks left</span>`;
    }
    whenHtml = row.isTimeLock ? `Unlocks ${new Date(row.lock.unlockTime * 1000).toLocaleString()}` : `Unlocks at block height ${row.lock.unlockTime}`;
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<div class="top"><span class="mono">${row.lock.address.slice(0, 10)}…${row.lock.address.slice(-6)}</span>${statusHtml}</div>
      <div class="hint" style="margin:4px 0">${whenHtml}</div>
      <div class="row">
        <button class="icon" data-copy-text="${row.lock.address}">⧉ copy address</button>
        ${canRedeem ? `<button class="btn" data-redeem="${row.lock.address}">Redeem</button>` : ''}
      </div>`;
    container.appendChild(div);
  }
}
// Ticks the visible countdowns between refreshes without hitting the API - it only updates
// the text, it never re-enables Redeem (that only happens after an explicit chain refresh).
setInterval(() => {
  if (!lastLockRows.length) return;
  const nowSec = Math.floor(Date.now() / 1000);
  document.querySelectorAll('[data-countdown]').forEach((el) => {
    const row = lastLockRows.find((r) => r.lock.address === el.dataset.countdown);
    if (row) el.textContent = `Locked — ${formatDuration(Math.max(0, row.lock.unlockTime - nowSec))} left`;
  });
}, 30000);

$('refreshLocks').onclick = guard(renderLocks);
$('myLocksList').addEventListener('click', (e) => {
  const copyBtn = e.target.closest('button[data-copy-text]');
  if (copyBtn) { navigator.clipboard?.writeText(copyBtn.dataset.copyText).then(() => toast('Copied', 'good')).catch(() => {}); return; }
  const redeemBtn = e.target.closest('button[data-redeem]');
  if (redeemBtn) redeemLock(redeemBtn.dataset.redeem);
});

const redeemLock = guard((address) => {
  if (!active) throw Error('Load the wallet this lock belongs to first.');
  const row = lastLockRows.find((r) => r.lock.address === address);
  if (!row) throw Error('Refresh my locks first.');
  if (!row.reached) throw Error('This lock has not reached its unlock time yet.');
  if (!row.utxos.length) throw Error('Nothing spendable there right now — refresh my locks.');
  const fee = Math.round(Number($('redeemFee').value || 0.01) * 1e8);
  const total = row.utxos.reduce((s, u) => s + u.value, 0);
  if (total <= fee) throw Error('The locked amount does not cover the redeem fee.');
  const toAddress = $('redeemTo').value.trim() || active.address;
  const value = total - fee;

  const txb = new bitcoin.TransactionBuilder(net());
  for (const u of row.utxos) txb.addInput(u.txid, u.index, CLTV.nonFinalSequence);
  txb.addOutput(toAddress, value);
  const tx = txb.buildIncomplete();
  tx.locktime = row.lock.unlockTime; // required for OP_CHECKLOCKTIMEVERIFY to pass
  const redeemScript = Buffer.from(row.lock.script, 'hex');
  row.utxos.forEach((u, i) => {
    const sigHash = tx.hashForSignature(i, redeemScript, bitcoin.Transaction.SIGHASH_ALL);
    const derSig = bitcoin.script.signature.encode(active.key.sign(sigHash), bitcoin.Transaction.SIGHASH_ALL);
    tx.setInputScript(i, Buffer.from(buildCltvScriptSig(hex(derSig), row.lock.script), 'hex'));
  });

  $('rawTx').value = tx.toHex();
  log({ redeemTransaction: true, from: address, to: toAddress, amountMwc: formatMwc(value), feeMwc: formatMwc(fee), unlockTime: row.lock.unlockTime, raw: $('rawTx').value });
  toast('Redeem transaction signed — review and broadcast it from the Send tab');
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
