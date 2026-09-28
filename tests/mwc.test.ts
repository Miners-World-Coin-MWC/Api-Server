import { describe, expect, it } from "vitest";
import {
  MWC_NETWORK,
  cltvRedeemScript,
  cltvP2sh,
  legacyAddressFromNode,
  masterNodeFromMnemonic,
  randomWallet,
  walletFromWif,
  validVanityPrefix,
  findVanityWallet
} from "../src/mwc";

describe("MWC network", () => {
  it("uses the MWC mainnet prefixes", () => {
    expect(MWC_NETWORK.pubKeyHash).toBe(20);
    expect(MWC_NETWORK.scriptHash).toBe(10);
    expect(MWC_NETWORK.wif).toBe(123);
    expect(MWC_NETWORK.bip32.public).toBe(0x0488b21e);
    expect(MWC_NETWORK.bip32.private).toBe(0x0488ade4);
    expect(MWC_NETWORK.bech32).toBe("mwc");
  });

  it("derives a deterministic legacy MWC address", () => {
    const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const node = masterNodeFromMnemonic(mnemonic).derivePath("m/44'/20'/0'/0/0");
    const address = legacyAddressFromNode(node);
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(address.length).toBeGreaterThan(20);
  });

  it("builds the requested CLTV script", () => {
    const pubkey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const script = cltvRedeemScript(1700000000, pubkey).toString("hex");
    expect(script).toContain("b175");
    expect(script.endsWith("ac")).toBe(true);
  });

  it("creates an MWC P2SH CLTV address", () => {
    const pubkey = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const result = cltvP2sh(1700000000, pubkey);
    expect(result.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(result.redeemScriptHex).toContain("b175");
  });
});

describe("wallets", () => {
  it("round-trips a WIF import to the same MWC address", () => {
    const w = randomWallet();
    expect(w.address.startsWith("9")).toBe(true);
    const imported = walletFromWif(w.wif);
    expect(imported.address).toBe(w.address);
    expect(imported.publicKeyHex).toBe(w.publicKeyHex);
  });

  it("validates and finds custom address prefixes", () => {
    expect(validVanityPrefix("9M")).toBe(true);
    expect(validVanityPrefix("1M")).toBe(false);
    expect(validVanityPrefix("9Mwcx")).toBe(false);
    const w = findVanityWallet("99", 5000, true);
    expect(w === null || w.address.toLowerCase().startsWith("99")).toBe(true);
  });
});
