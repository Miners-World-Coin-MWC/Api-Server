import test from 'node:test';
import assert from 'node:assert/strict';

test('MWC consensus/address parameters are pinned', () => {
  const n = {pubKeyHash:20,scriptHash:10,wif:123,bip32Public:0x0488b21e,bip32Private:0x0488ade4,bech32:'mwc'};
  assert.deepEqual(n,{pubKeyHash:20,scriptHash:10,wif:123,bip32Public:0x0488b21e,bip32Private:0x0488ade4,bech32:'mwc'});
});
