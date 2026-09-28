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

function net() { return MWC_NETWORK; }
function keyFromWif(wif) { return bitcoin.ECPair.fromWIF(wif.trim(), net()); }
function addressFromKey(key) { return bitcoin.payments.p2pkh({pubkey:key.publicKey, network:net()}).address; }
function hex(b) { return Buffer.from(b).toString('hex'); }
function formatMwc(v) { return (Number(v)/1e8).toLocaleString(undefined,{maximumFractionDigits:8}); }
function log(v) { out.textContent = typeof v === 'string' ? v : JSON.stringify(v,null,2); }
function walletFromKey(key, extra={}) { active={key,wif:key.toWIF(),address:addressFromKey(key),...extra}; refreshWallet(); return active; }
function refreshWallet() { if(!active)return; $('walletAddress').textContent=active.address; $('walletWif').value=active.wif; $('walletPub').value=hex(active.key.publicKey); $('walletPath').textContent=active.path||'single-key'; }

$('createWallet').onclick=()=>{
  const mnemonic=bip39.generateMnemonic(256);
  const seed=bip39.mnemonicToSeedSync(mnemonic);
  const path=`m/44'/0'/0'/0/0`;
  const child=bip32.fromSeed(seed,net()).derivePath(path);
  const key=bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey),{network:net()});
  walletFromKey(key,{mnemonic,path});
  $('mnemonic').value=active.mnemonic;
  log({created:true,address:active.address,mnemonic:active.mnemonic,wif:active.wif,warning:'Back up the mnemonic/private key offline before using funds.'});
};
$('importWif').onclick=()=>{ try{ walletFromKey(keyFromWif($('wif').value)); log({imported:'WIF',address:active.address,wif:active.wif}); }catch(e){log(e.message)} };
$('importPrivate').onclick=()=>{ try{ const h=$('privateHex').value.trim().replace(/^0x/,''); if(!/^[0-9a-fA-F]{64}$/.test(h))throw Error('Private key must be 32-byte hex.'); walletFromKey(bitcoin.ECPair.fromPrivateKey(Buffer.from(h,'hex'),{network:net()})); log({imported:'private key',address:active.address,wif:active.wif}); }catch(e){log(e.message)} };
$('importMnemonic').onclick=()=>{
  try{
    const phrase=$('mnemonic').value.trim(); if(!bip39.validateMnemonic(phrase))throw Error('Invalid BIP39 mnemonic.');
    const seed=bip39.mnemonicToSeedSync(phrase); const root=bip32.fromSeed(seed,net());
    const path=`m/44'/${0}'/0'/0/0`; const child=root.derivePath(path);
    const key=bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey),{network:net()});
    walletFromKey(key,{mnemonic:phrase,path}); log({imported:'BIP39',address:active.address,path,wif:active.wif});
  }catch(e){log(e.message)}
};
$('importXprv').onclick=()=>{try{const x=$('xprv').value.trim();const root=bip32.fromBase58(x,net());const child=root.derivePath(`m/44'/0'/0'/0/0`);const key=bitcoin.ECPair.fromPrivateKey(Buffer.from(child.privateKey),{network:net()});walletFromKey(key,{path:`m/44'/0'/0'/0/0`});log({imported:'xprv',address:active.address,wif:active.wif});}catch(e){log(e.message)}};
$('importXpub').onclick=()=>{try{const x=$('xpub').value.trim();const root=bip32.fromBase58(x,net());const child=root.derive(0).derive(0);const address=bitcoin.payments.p2pkh({pubkey:Buffer.from(child.publicKey),network:net()}).address; $('watchAddress').value=address;log({imported:'xpub',watchOnly:true,address});}catch(e){log(e.message)}};

$('checkBalance').onclick=async()=>{try{const a=($('watchAddress').value||active?.address||'').trim();if(!a)throw Error('Enter an address or import/create a wallet.');const r=await api.balance(a);currentUtxos=r.confirmed.utxos||[];$('sendAddress').value=a;log({address:a,balanceMwc:formatMwc(r.confirmed.balance),receivedMwc:formatMwc(r.confirmed.received),utxos:currentUtxos,mempool:r.mempool});}catch(e){log(e.message)}};
$('history').onclick=async()=>{try{const a=($('watchAddress').value||active?.address||'').trim();log(await api.history(a));}catch(e){log(e.message)}};
$('node').onclick=async()=>{try{log(await api.nodechain())}catch(e){log(e.message)}};
$('params').onclick=async()=>{try{log(await api.paramschain())}catch(e){log(e.message)}};
$('fee').onclick=async()=>{try{log(await api.fee())}catch(e){log(e.message)}};

$('send').onclick=async()=>{
 try{
  if(!active)throw Error('Import/create a signing wallet first.');
  const to=$('sendTo').value.trim(); const amount=Math.round(Number($('sendAmount').value)*1e8); const fee=Math.round(Number($('sendFee').value||0.01)*1e8);
  if(!to)throw Error('Recipient is required.'); if(!Number.isSafeInteger(amount)||amount<=0)throw Error('Invalid amount.');
  if(!Number.isSafeInteger(fee)||fee<0)throw Error('Invalid fee.');
  const sorted=[...currentUtxos].sort((a,b)=>b.value-a.value);let selected=[],total=0;for(const u of sorted){selected.push(u);total+=u.value;if(total>=amount+fee)break;}if(total<amount+fee)throw Error('Insufficient confirmed UTXOs. Refresh balance first.');
  const txb=new bitcoin.TransactionBuilder(net());for(const u of selected)txb.addInput(u.txid,u.index);txb.addOutput(to,amount);const change=total-amount-fee;if(change>0)txb.addOutput(active.address,change);selected.forEach((u,i)=>txb.sign(i,active.key));const raw=txb.build().toHex();
  $('rawTx').value=raw;log({unsignedIntent:{to,amountMwc:formatMwc(amount),feeMwc:formatMwc(fee),changeMwc:formatMwc(change)},raw});
 }catch(e){log(e.message)}
};
$('broadcast').onclick=async()=>{try{const raw=$('rawTx').value.trim();if(!raw)throw Error('No raw transaction.');if(!confirm('Broadcast this signed transaction to the MWC network?'))return;log(await api.broadcast(raw));}catch(e){log(e.message)}};

$('vanity').onclick=async()=>{try{const wanted=$('vanityPrefix').value.trim();if(!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,6}$/.test(wanted))throw Error('Vanity prefix must be 1-6 Base58 characters.');let attempts=0;const start=performance.now();while(true){const key=bitcoin.ECPair.makeRandom({network:net()});attempts++;const a=addressFromKey(key);if(a.startsWith(wanted)){walletFromKey(key);log({vanity:true,prefix:wanted,address:a,wif:key.toWIF(),attempts,seconds:(performance.now()-start)/1000});break}if(attempts%1000===0){$('vanityStatus').textContent=`${attempts.toLocaleString()} attempts`;await new Promise(r=>setTimeout(r,0));}}}catch(e){log(e.message)}};

$('makeCltv').onclick=()=>{try{const t=Number($('unlockTime').value);const pub=$('lockPub').value.trim()||hex(active?.key?.publicKey||[]);const script=createCltvRedeemScript(bitcoin,t,pub);const redeem=Buffer.from(script,'hex');const p2sh=bitcoin.payments.p2sh({redeem:{output:redeem},network:net()});$('cltvScript').value=script;$('cltvAddress').value=p2sh.address;log({unlockTime:t,pubkey:pub,redeemScript:script,p2shAddress:p2sh.address,template:'<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG'});}catch(e){log(e.message)}};
$('lockFunds').onclick=()=>{try{if(!active)throw Error('Create/import wallet first.');const to=$('cltvAddress').value.trim();const amount=Math.round(Number($('lockAmount').value)*1e8);const fee=Math.round(Number($('lockFee').value||0.01)*1e8);const unlock=Number($('unlockTime').value);if(!to||!Number.isSafeInteger(amount)||amount<=0)throw Error('Invalid lock destination/amount.');const sorted=[...currentUtxos].sort((a,b)=>b.value-a.value);let selected=[],total=0;for(const u of sorted){selected.push(u);total+=u.value;if(total>=amount+fee)break}if(total<amount+fee)throw Error('Insufficient UTXOs. Refresh balance.');const txb=new bitcoin.TransactionBuilder(net());for(const u of selected)txb.addInput(u.txid,u.index);txb.addOutput(to,amount);const change=total-amount-fee;if(change)txb.addOutput(active.address,change);selected.forEach((u,i)=>txb.sign(i,active.key));$('rawTx').value=txb.build().toHex();log({lockTransaction:true,unlockTime:unlock,p2shAddress:to,amountMwc:formatMwc(amount),feeMwc:formatMwc(fee),raw:$('rawTx').value});}catch(e){log(e.message)}};

$('exportBackup').onclick=async()=>{try{if(!active)throw Error('No wallet loaded.');const password=$('backupPassword').value;if(password.length<12)throw Error('Use a backup password of at least 12 characters.');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);const payload=JSON.stringify({version:1,wif:active.wif,mnemonic:active.mnemonic||null,path:active.path||null,address:active.address});const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(payload));const b64=x=>btoa(String.fromCharCode(...new Uint8Array(x)));const blob=JSON.stringify({v:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),data:b64(ct)});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([blob],{type:'application/json'}));a.download='mwc-wallet-backup.json';a.click();}catch(e){log(e.message)}};

log({ready:true,network:'MWC',api:'https://api.minersworld.org',features:['mnemonic','WIF/private key','xprv/xpub','watch-only','local vanity <=6','P2PKH send/sign/broadcast','CLTV P2SH lock','encrypted backup'],parameters:{pubKeyHash:20,scriptHash:10,wif:123,bip32Public:'0488b21e',bip32Private:'0488ade4',bech32:'mwc'}});
