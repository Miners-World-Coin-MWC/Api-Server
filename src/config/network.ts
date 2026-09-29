export const MWC_NETWORK = Object.freeze({
  messagePrefix: "\x18MinersWorldCoin Signed Message:\n",
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4
  },
  pubKeyHash: 20,
  scriptHash: 10,
  wif: 123,
  bech32: "mwc"
} as const);

export const MWC_API_BASE = "https://api.minersworld.org";

export const MWC_CHAIN = Object.freeze({
  symbol: "MWC",
  name: "MinersWorldCoin",
  blockTargetSeconds: 120,
  maxSupply: 300_000_000,
  blockRewardMwc: 270,
  developerOperationsFeeMwc: 30,
  minerRewardMwc: 270,
  halvingInterval: 300_000,
  maxHalvings: 64
} as const);

export const CLTV = Object.freeze({
  opcodeName: "OP_CHECKLOCKTIMEVERIFY",
  maxVanityPrefixLength: 10,
  nonFinalSequence: 0xfffffffe,
  // BIP65: values below this are interpreted as a block height, at/above it as a unix time.
  timeThreshold: 500_000_000
} as const);
