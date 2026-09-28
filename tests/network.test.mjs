import test from "node:test";
import assert from "node:assert/strict";

test("MWC network constants", async () => {
  const source = await import("../src/config/network.ts");
  assert.equal(source.MWC_NETWORK.pubKeyHash, 20);
  assert.equal(source.MWC_NETWORK.scriptHash, 10);
  assert.equal(source.MWC_NETWORK.wif, 123);
  assert.equal(source.MWC_NETWORK.bech32, "mwc");
  assert.equal(source.MWC_NETWORK.bip32.public, 0x0488b21e);
  assert.equal(source.MWC_NETWORK.bip32.private, 0x0488ade4);
});
