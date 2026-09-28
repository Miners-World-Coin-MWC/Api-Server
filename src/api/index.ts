import { MWC_CHAIN, MWC_NETWORK, CLTV } from "../config/network.js";
import { MWCAPIClient } from "./client.js";
import type {
  BalanceResult,
  ChainParamsResult,
  HistoryItem,
  NodeChainResult
} from "../types.js";

export class MWCWalletAPI extends MWCAPIClient {
  async nodechain(): Promise<NodeChainResult> {
    const [info, peers] = await Promise.all([this.info(), this.peers()]);
    const max = Math.max(info.blocks, info.headers);
    const progress = max === 0 ? 1 : Math.min(info.blocks / max, 1);

    return {
      height: info.blocks,
      bestblockhash: info.bestblockhash,
      headers: info.headers,
      blocks: info.blocks,
      difficulty: info.difficulty,
      peers,
      sync: {
        synced: info.blocks === info.headers,
        progress,
        blocks: info.blocks,
        headers: info.headers
      }
    };
  }

  async paramschain(): Promise<ChainParamsResult> {
    return {
      network: "main",
      symbol: "MWC",
      address: MWC_NETWORK,
      chain: MWC_CHAIN,
      cltv: {
        type: "CLTV",
        scriptTemplate:
          "<unlock-time> OP_CHECKLOCKTIMEVERIFY OP_DROP <their pubkey> OP_CHECKSIG",
        nonFinalSequence: CLTV.nonFinalSequence
      }
    };
  }

  async minimum() {
    const fee = await this.fee();
    return {
      lockType: "CLTV",
      source: "client-chain-parameters",
      minimum: null,
      unit: "seconds",
      fee
    };
  }

  async balance(address: string): Promise<BalanceResult> {
    const [confirmed, utxos, mempool] = await Promise.all([
      super.balance(address),
      super.unspent(address),
      super.mempoolAddress(address)
    ]);

    return {
      address,
      confirmed: {
        balance: confirmed.balance,
        received: confirmed.received,
        utxos
      },
      mempool
    };
  }

  async history(address: string): Promise<HistoryItem[]> {
    const result = await super.history(address);
    const txs = await Promise.all(
      result.tx.map(async (txid) => {
        const tx = await super.transaction(txid);
        const confirmations =
          typeof tx === "object" &&
          tx !== null &&
          "confirmations" in tx &&
          typeof (tx as { confirmations?: unknown }).confirmations === "number"
            ? (tx as { confirmations: number }).confirmations
            : 0;

        return {
          txid,
          confirmations,
          transaction: tx
        };
      })
    );

    return txs;
  }

  async healthsync() {
    const [node, mempool] = await Promise.all([
      this.nodechain(),
      this.mempool()
    ]);

    return {
      sync: node.sync,
      peers: node.peers,
      mempool,
      solvency: {
        status: "unknown",
        reason:
          "No off-chain solvency ledger is configured. This stateless SDK reports chain/node health only."
      },
      worker: {
        status: "unknown",
        reason: "No worker database or worker service is configured."
      }
    };
  }

  async ledgerincome() {
    return {
      status: "chain-derived-only",
      income: null,
      allocated: null,
      settled: null,
      solvency: "unknown",
      reason:
        "A stateless GitHub-hosted SDK cannot invent or persist an off-chain ledger. Add deterministic on-chain accounting rules if these fields are to become numeric."
    };
  }

  async locks(_pubkey: string) {
    return {
      pubkey: _pubkey,
      locks: [],
      source: "chain-scan-required",
      note:
        "This stateless endpoint does not maintain an index. Use the local lock scanner against address history/UTXOs to discover matching CLTV outputs."
    };
  }

  async owed(pubkey: string) {
    return {
      pubkey,
      rewards: [],
      total: 0,
      status: "chain-derived-only",
      note:
        "No off-chain owed/reward ledger is stored. Implement deterministic coinbase/reward accounting when the exact MWC reward entitlement rules are defined."
    };
  }
}
