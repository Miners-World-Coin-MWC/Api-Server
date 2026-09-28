export type ApiEnvelope<T> = {
  error: unknown;
  id?: string;
  result: T;
};

export type MwcInfo = {
  bestblockhash: string;
  blocks: number;
  chain: string;
  chainwork: string;
  difficulty: number;
  headers: number;
  mediantime: number;
  nethash: number;
  reward: number;
  supply: number;
};

export type MwcUtxo = {
  height: number;
  index: number;
  script: string;
  txid: string;
  value: number;
  confirmations?: number;
};

export type BalanceResult = {
  address: string;
  confirmed: {
    balance: number;
    received: number;
    utxos: MwcUtxo[];
  };
  mempool: {
    tx: string[];
    txcount: number;
  };
};

export type HistoryItem = {
  txid: string;
  confirmations: number;
  transaction?: unknown;
};

export type NodeChainResult = {
  height: number;
  bestblockhash: string;
  headers: number;
  blocks: number;
  difficulty: number;
  peers: unknown[];
  sync: {
    synced: boolean;
    progress: number;
    blocks: number;
    headers: number;
  };
};

export type ChainParamsResult = {
  network: "main";
  symbol: "MWC";
  address: typeof import("./config/network.js").MWC_NETWORK;
  chain: typeof import("./config/network.js").MWC_CHAIN;
  cltv: {
    type: "CLTV";
    scriptTemplate: string;
    nonFinalSequence: number;
  };
};

export type LockDescriptor = {
  unlockTime: number;
  pubkeyHex: string;
  redeemScriptHex?: string;
};

export type VanityProgress = {
  attempts: number;
  elapsedMs: number;
  rate: number;
};
