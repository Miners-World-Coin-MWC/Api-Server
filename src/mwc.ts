import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { BIP32Factory } from "bip32";
import { ECPairFactory } from "ecpair";
import * as bip39 from "bip39";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

export const MWC_NETWORK: bitcoin.Network = {
  messagePrefix: "\x18MinersWorldCoin Signed Message:\n",
  bech32: "mwc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 20,
  scriptHash: 10,
  wif: 123
};

export const SIGHASH_ALL = bitcoin.Transaction.SIGHASH_ALL;

export function mnemonicGenerate(strength = 128): string {
  return bip39.generateMnemonic(strength);
}

export function mnemonicToSeed(mnemonic: string, password = ""): Uint8Array {
  return bip39.mnemonicToSeedSync(mnemonic, password);
}

export function masterNodeFromMnemonic(mnemonic: string, password = "") {
  return bip32.fromSeed(mnemonicToSeed(mnemonic, password), MWC_NETWORK);
}

export function deriveNode(mnemonic: string, path = "m/44'/20'/0'/0/0", password = "") {
  return masterNodeFromMnemonic(mnemonic, password).derivePath(path);
}

export function addressFromNode(node: { publicKey: Uint8Array }) {
  return bitcoin.payments.p2wpkh({ pubkey: Buffer.from(node.publicKey), network: MWC_NETWORK }).address!;
}

export function legacyAddressFromNode(node: { publicKey: Uint8Array }) {
  return bitcoin.payments.p2pkh({ pubkey: Buffer.from(node.publicKey), network: MWC_NETWORK }).address!;
}

export function p2shAddress(redeemScriptHex: string): string {
  const redeem = Buffer.from(redeemScriptHex, "hex");
  return bitcoin.payments.p2sh({ redeem: { output: redeem }, network: MWC_NETWORK }).address!;
}

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

export function cltvP2sh(unlockTime: number, publicKeyHex: string) {
  const redeem = cltvRedeemScript(unlockTime, publicKeyHex);
  const address = bitcoin.payments.p2sh({ redeem: { output: redeem }, network: MWC_NETWORK }).address!;
  return { redeemScriptHex: redeem.toString("hex"), address, unlockTime };
}

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  scriptPubKeyHex: string;
  address?: string;
  previousTransactionHex?: string;
  redeemScriptHex?: string;
}

export interface TxOutput {
  address?: string;
  scriptHex?: string;
  value: number;
}

export function buildTransaction(
  utxos: Utxo[],
  outputs: TxOutput[],
  feeAtomic: number,
  version = 2
): bitcoin.Psbt {
  if (!Number.isSafeInteger(feeAtomic) || feeAtomic < 0) throw new Error("Invalid fee");
  const psbt = new bitcoin.Psbt({ network: MWC_NETWORK });
  psbt.setVersion(version);

  for (const u of utxos) {
    if (!/^[0-9a-f]{64}$/i.test(u.txid)) throw new Error("Invalid txid");
    if (u.previousTransactionHex) {
      const input: any = {
        hash: u.txid,
        index: u.vout,
        sequence: 0xfffffffe,
        nonWitnessUtxo: Buffer.from(u.previousTransactionHex, "hex")
      };
      if (u.redeemScriptHex) input.redeemScript = Buffer.from(u.redeemScriptHex, "hex");
      psbt.addInput(input);
    } else {
      const input: any = {
        hash: u.txid,
        index: u.vout,
        sequence: 0xfffffffe,
        witnessUtxo: {
          script: Buffer.from(u.scriptPubKeyHex, "hex"),
          value: u.value
        }
      };
      if (u.redeemScriptHex) input.redeemScript = Buffer.from(u.redeemScriptHex, "hex");
      psbt.addInput(input);
    }
  }

  let totalOut = 0;
  for (const output of outputs) {
    if (!Number.isSafeInteger(output.value) || output.value <= 0) throw new Error("Invalid output value");
    totalOut += output.value;
    if (output.address) psbt.addOutput({ address: output.address, value: output.value });
    else if (output.scriptHex) psbt.addOutput({ script: Buffer.from(output.scriptHex, "hex"), value: output.value });
    else throw new Error("Output requires address or scriptHex");
  }

  const totalIn = utxos.reduce((sum, u) => sum + u.value, 0);
  if (totalIn < totalOut + feeAtomic) throw new Error("Insufficient funds");
  return psbt;
}

const ECPair = ECPairFactory(ecc);

export function signTransaction(psbt: bitcoin.Psbt, privateKeysWif: string[]) {
  for (const wif of privateKeysWif) {
    const key = ECPair.fromWIF(wif, MWC_NETWORK);
    psbt.signAllInputs(key);
  }
  psbt.finalizeAllInputs();
  return psbt.extractTransaction().toHex();
}

// ---------- wallets: WIF import, random, custom (vanity) ----------

export interface WalletKey { wif: string; publicKeyHex: string; address: string; }

function walletFromKeyPair(kp: { publicKey: Uint8Array; toWIF(): string }): WalletKey {
  const pub = Buffer.from(kp.publicKey);
  return {
    wif: kp.toWIF(),
    publicKeyHex: pub.toString("hex"),
    address: bitcoin.payments.p2pkh({ pubkey: pub, network: MWC_NETWORK }).address!
  };
}

/** Import a private key in WIF (MWC prefix 123). */
export function walletFromWif(wif: string): WalletKey {
  return walletFromKeyPair(ECPair.fromWIF(wif.trim(), MWC_NETWORK));
}

export function walletFromNode(node: { publicKey: Uint8Array; toWIF(): string }): WalletKey {
  return walletFromKeyPair(node);
}

export function randomWallet(): WalletKey {
  return walletFromKeyPair(ECPair.makeRandom({ network: MWC_NETWORK }));
}

/** MWC P2PKH addresses always start with "9" (version byte 20), so custom prefixes must too. */
export function validVanityPrefix(prefix: string): boolean {
  return /^9[1-9A-HJ-NP-Za-km-z]{0,3}$/.test(prefix);
}

/** Try `tries` random keys; returns a wallet whose address starts with `prefix`, else null. */
export function findVanityWallet(prefix: string, tries: number, ignoreCase = false): WalletKey | null {
  if (!validVanityPrefix(prefix)) throw new Error("Prefix must start with 9, use base58 characters, max 4 characters.");
  const want = ignoreCase ? prefix.toLowerCase() : prefix;
  for (let i = 0; i < tries; i++) {
    const w = randomWallet();
    const a = ignoreCase ? w.address.toLowerCase() : w.address;
    if (a.startsWith(want)) return w;
  }
  return null;
}

// ---------- time-lock spend (CLTV) ----------

/** Spend funds sitting in a CLTV lock back to any address. Only valid once unlockTime has passed. */
export function buildCltvSpend(
  utxos: Utxo[], toAddress: string, valueAtomic: number, unlockTime: number, redeemScriptHex: string
): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: MWC_NETWORK });
  psbt.setVersion(2);
  psbt.setLocktime(unlockTime);
  for (const u of utxos) {
    if (!u.previousTransactionHex) throw new Error("Previous transaction hex is required to spend a lock");
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      sequence: 0xfffffffe, // must not be SEQUENCE_FINAL or CLTV is not enforced
      nonWitnessUtxo: Buffer.from(u.previousTransactionHex, "hex"),
      redeemScript: Buffer.from(redeemScriptHex, "hex")
    });
  }
  psbt.addOutput({ address: toAddress, value: valueAtomic });
  return psbt;
}

/** Sign and finalize a CLTV spend: scriptSig = <signature> <redeemScript>. */
export function signCltvSpend(psbt: bitcoin.Psbt, wif: string): string {
  psbt.signAllInputs(ECPair.fromWIF(wif, MWC_NETWORK));
  psbt.data.inputs.forEach((_input, i) => {
    psbt.finalizeInput(i, (_idx, input) => ({
      finalScriptSig: bitcoin.script.compile([input.partialSig![0].signature, input.redeemScript!]),
      finalScriptWitness: undefined
    }));
  });
  return psbt.extractTransaction().toHex();
}
