import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getOriginalJson } from "../lib/originalApi";
import { fail, ok } from "../lib/response";
import { validBase58ish, validHex, positiveInt } from "../lib/validate";
import { atomicString } from "../lib/money";
import { cltvP2sh } from "../lib/lockScript";

export async function nodechain(c: Context<AppEnv>) {
  const id = c.get("requestId");
  try {
    const [info, peers] = await Promise.all([
      getOriginalJson<any>(c.env, "/info"),
      getOriginalJson<any>(c.env, "/peers")
    ]);
    const blocks = Number(info.blocks ?? info.height ?? 0);
    const headers = Number(info.headers ?? blocks);
    const synced = headers <= blocks;
    return ok({
      chain: c.env.CHAIN,
      height: blocks,
      headers,
      best_block_hash: info.bestblockhash ?? info.hash ?? null,
      difficulty: info.difficulty ?? null,
      median_time: info.mediantime ?? null,
      peers: Array.isArray(peers) ? peers.length : Number(peers?.count ?? 0),
      sync: {
        state: synced ? "synced" : "syncing",
        progress_percent: headers > 0 ? Math.min(100, (blocks / headers) * 100) : 0
      }
    }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}

export async function paramschain(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const minLock = Number.parseInt(c.env.MWC_MIN_LOCK_SECONDS || "0", 10);
  return ok({
    chain: c.env.CHAIN,
    coin: "MWC",
    decimals: 8,
    address_prefix: 20,
    script_prefix: 10,
    wif_prefix: 123,
    xpub_prefix: "0488b21e",
    xprv_prefix: "0488ade4",
    bech32_hrp: "mwc",
    block_time_seconds: 120,
    halving_interval: 300000,
    max_supply_mwc: 300000000,
    segwit: true,
    cltv: {
      opcode: "OP_CHECKLOCKTIMEVERIFY",
      threshold: 500000000,
      minimum_lock_seconds: minLock,
      minimum_lock_configured: minLock > 0
    }
  }, id);
}

export async function minimum(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const seconds = Number.parseInt(c.env.MWC_MIN_LOCK_SECONDS || "0", 10);
  return ok({
    coin: "MWC",
    date_utc: new Date().toISOString().slice(0, 10),
    minimum_lock_seconds: seconds,
    configured: seconds > 0
  }, id);
}

export async function balance(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const address = c.req.param("address");
  if (!validBase58ish(address)) return fail("INVALID_ADDRESS", "Invalid MWC address.", id);
  try {
    const [balance, unspent] = await Promise.all([
      getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(address)}`),
      getOriginalJson<any>(c.env, `/unspent/${encodeURIComponent(address)}`)
    ]);
    let utxos: any[] = Array.isArray(unspent) ? unspent : (unspent?.unspent ?? []);
    const withPrevTx = c.req.query("with_prevtx") === "1";
    if (withPrevTx) {
      utxos = await Promise.all(utxos.map(async (u: any) => {
        const txid = u.txid ?? u.hash ?? u.tx_hash;
        if (!txid) return u;
        try {
          const detail = await getOriginalJson<any>(c.env, `/transaction/${encodeURIComponent(txid)}`);
          const raw = detail?.hex ?? detail?.raw ?? detail?.rawtx ?? detail?.raw_transaction;
          return raw ? { ...u, previousTransactionHex: raw } : u;
        } catch {
          return u;
        }
      }));
    }
    return ok({
      address,
      confirmed_balance_atomic: atomicString(balance?.balance ?? balance?.confirmed ?? 0),
      received_atomic: atomicString(balance?.received ?? 0),
      utxos
    }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}

export async function history(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const address = c.req.param("address");
  if (!validBase58ish(address)) return fail("INVALID_ADDRESS", "Invalid MWC address.", id);
  try {
    const offset = positiveInt(c.req.query("offset"), 0, 1000000);
    const limit = positiveInt(c.req.query("limit"), 25, 100);
    const raw = await getOriginalJson<any>(c.env, `/history/${encodeURIComponent(address)}`, `?offset=${offset}&limit=${limit}`);
    const txs = Array.isArray(raw) ? raw : (raw?.transactions ?? raw?.history ?? []);
    const selected = txs.slice(0, limit);
    const enriched = await Promise.all(selected.map(async (tx: any) => {
      const hash = tx.txid ?? tx.hash ?? tx.tx_hash;
      if (!hash) return { ...tx, confirmations: null };
      try {
        const detail = await getOriginalJson<any>(c.env, `/transaction/${encodeURIComponent(hash)}`);
        return {
          ...tx,
          confirmations: detail?.confirmations ?? null,
          transaction: detail
        };
      } catch {
        return { ...tx, confirmations: null };
      }
    }));
    return ok({ address, offset, limit, transactions: enriched }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}

/**
 * Fully stateless, non-custodial CLTV lock lookup. No database, no admin, nothing to register.
 *
 * A CLTV lock's address is 100% deterministic from (pubkey, unlock_time). The wallet that
 * created the lock already knows both values (it built the script client-side and broadcast
 * it itself), so there's nothing to "index" server-side — this endpoint just recomputes the
 * same address on demand and asks the original chain API what's actually sitting there right
 * now. That also means there's no way to discover a lock's unlock_time if you've forgotten
 * it; the wallet is responsible for remembering the locks it created (e.g. in its own local
 * storage), the same way it's responsible for the private key.
 *
 * GET /api/locks/:pubkey?unlock_time=170000000&lock_type=time
 */
export async function locks(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const rawPubkey = c.req.param("pubkey");
  if (!rawPubkey) return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  const pubkey = rawPubkey.toLowerCase();
  if (!validHex(pubkey, 33) && !validHex(pubkey, 65)) {
    return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  }

  const unlockTime = Number.parseInt(c.req.query("unlock_time") ?? "", 10);
  const lockType = c.req.query("lock_type");
  if (!Number.isInteger(unlockTime) || unlockTime < 0 || unlockTime > 0xffffffff) {
    return fail("INVALID_UNLOCK_TIME", "Query param unlock_time is required and must be an unsigned 32-bit integer.", id);
  }
  if (lockType !== "height" && lockType !== "time") {
    return fail("INVALID_LOCK_TYPE", "Query param lock_type must be 'height' or 'time'.", id);
  }

  let derived: { redeemScriptHex: string; address: string };
  try {
    derived = cltvP2sh(unlockTime, pubkey);
  } catch (e) {
    return fail("INVALID_LOCK", `Could not derive lock address: ${String(e)}`, id);
  }

  try {
    const [balanceData, unspentData, info] = await Promise.all([
      getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(derived.address)}`),
      getOriginalJson<any>(c.env, `/unspent/${encodeURIComponent(derived.address)}`),
      getOriginalJson<any>(c.env, "/info")
    ]);
    const utxos = Array.isArray(unspentData) ? unspentData : (unspentData?.unspent ?? []);
    const tip = lockType === "height" ? Number(info.blocks ?? info.height ?? 0) : Number(info.mediantime ?? 0);
    return ok({
      pubkey,
      unlock_time: unlockTime,
      lock_type: lockType,
      address: derived.address,
      redeem_script_hex: derived.redeemScriptHex,
      balance_atomic: atomicString(balanceData?.balance ?? balanceData?.confirmed ?? 0),
      utxos,
      spendable_now: tip >= unlockTime
    }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}

export async function healthsync(c: Context<AppEnv>) {
  const id = c.get("requestId");
  try {
    const info = await getOriginalJson<any>(c.env, "/info");
    const blocks = Number(info.blocks ?? info.height ?? 0);
    const headers = Number(info.headers ?? blocks);
    return ok({
      api: "ok",
      chain: {
        height: blocks,
        headers,
        synced: headers <= blocks
      },
      checked_at: Math.floor(Date.now() / 1000)
    }, id);
  } catch (e) {
    return fail("HEALTHCHECK_FAILED", String(e), id, 503);
  }
}

/**
 * Fully stateless "how much of my locked-up MWC can I claim right now" check.
 *
 * There's no ledger — "owed" here means the same thing /api/locks/:pubkey reports per lock
 * (funded + already past its unlock time), just summed across every unlock_time the caller
 * asks about. The wallet supplies the candidate unlock_times it created (it already knows
 * them), and this recomputes + checks each address live, exactly like /api/locks/:pubkey.
 *
 * GET /api/owed/:pubkey?unlock_times=1780000000,850000
 * (values are auto-detected as height vs. unix time using the same BIP65 500,000,000
 * threshold Bitcoin/MWC use to interpret CLTV lock values, so no separate lock_type param
 * is needed here.)
 */
export async function owed(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const rawPubkey = c.req.param("pubkey");
  if (!rawPubkey) return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  const pubkey = rawPubkey.toLowerCase();
  if (!validHex(pubkey, 33) && !validHex(pubkey, 65)) {
    return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  }

  const CLTV_TIME_THRESHOLD = 500000000; // BIP65: values below this are a block height, at/above it a unix time
  const raw = c.req.query("unlock_times") ?? "";
  const unlockTimes = [...new Set(
    raw.split(",").map(s => Number.parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff)
  )];
  if (unlockTimes.length === 0) {
    return fail("INVALID_UNLOCK_TIMES", "Query param unlock_times is required: a comma-separated list of the unlock times used when you created your locks.", id);
  }
  if (unlockTimes.length > 50) {
    return fail("TOO_MANY_UNLOCK_TIMES", "Provide at most 50 unlock_times per request.", id);
  }

  try {
    const info = await getOriginalJson<any>(c.env, "/info");
    const height = Number(info.blocks ?? info.height ?? 0);
    const medianTime = Number(info.mediantime ?? 0);

    const results = await Promise.all(unlockTimes.map(async (unlockTime) => {
      const lockType = unlockTime >= CLTV_TIME_THRESHOLD ? "time" : "height";
      const tip = lockType === "time" ? medianTime : height;
      let derived: { redeemScriptHex: string; address: string };
      try {
        derived = cltvP2sh(unlockTime, pubkey);
      } catch (e) {
        return { unlock_time: unlockTime, lock_type: lockType, error: String(e) };
      }
      try {
        const balanceData = await getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(derived.address)}`);
        const balanceAtomic = BigInt(atomicString(balanceData?.balance ?? balanceData?.confirmed ?? 0));
        return {
          unlock_time: unlockTime,
          lock_type: lockType,
          address: derived.address,
          balance_atomic: balanceAtomic.toString(),
          spendable_now: tip >= unlockTime && balanceAtomic > 0n
        };
      } catch (e) {
        return { unlock_time: unlockTime, lock_type: lockType, address: derived.address, error: String(e) };
      }
    }));

    const owedAtomic = results.reduce((sum, r: any) => sum + (r.spendable_now ? BigInt(r.balance_atomic) : 0n), 0n);

    return ok({
      pubkey,
      owed_atomic: owedAtomic.toString(),
      locks: results
    }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}

/**
 * On-chain ledger. No database: the "ledger" is simply the public chain state of wallets you
 * designate. Create a wallet (the web wallet can do it), then point the server at it:
 *   INCOME_ADDRESS        the wallet income is paid into
 *   ALLOCATION_ADDRESSES  optional, comma-separated wallets holding earmarked/allocated funds
 *
 *   income     = everything ever received by INCOME_ADDRESS
 *   available  = what INCOME_ADDRESS still holds
 *   settled    = income - available   (what has left the income wallet)
 *   allocated  = total currently held by the ALLOCATION_ADDRESSES
 *   solvent    = available >= allocated
 */
export async function ledgerincome(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const income = c.env.INCOME_ADDRESS;
  if (!income || !validBase58ish(income)) {
    return fail("NOT_CONFIGURED", "Set INCOME_ADDRESS to the on-chain wallet that receives income.", id, 503);
  }
  const allocationAddresses = (c.env.ALLOCATION_ADDRESSES ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!allocationAddresses.every(a => validBase58ish(a))) {
    return fail("NOT_CONFIGURED", "ALLOCATION_ADDRESSES contains an invalid address.", id, 503);
  }
  try {
    const [incomeBal, ...allocBals] = await Promise.all([
      getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(income)}`),
      ...allocationAddresses.map(a => getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(a)}`))
    ]);
    const received = BigInt(atomicString(incomeBal?.received ?? 0));
    const available = BigInt(atomicString(incomeBal?.balance ?? 0));
    const settled = received - available;
    const allocated = allocBals.reduce((s, b) => s + BigInt(atomicString(b?.balance ?? 0)), 0n);
    return ok({
      income_address: income,
      allocation_addresses: allocationAddresses,
      income_atomic: received.toString(),
      allocated_atomic: allocated.toString(),
      settled_atomic: settled.toString(),
      available_atomic: available.toString(),
      solvent: available >= allocated
    }, id);
  } catch (e) {
    return fail("UPSTREAM_ERROR", String(e), id, 502);
  }
}
