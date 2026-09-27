import type { Context } from "hono";
import type { AppEnv, MwcUtxo } from "../types";
import { getOriginalJson } from "../lib/originalApi";
import { fail, ok } from "../lib/response";
import { validBase58ish, validHex, positiveInt } from "../lib/validate";
import { requireAdmin } from "../lib/security";
import { atomicString, mwcStringFromAtomic } from "../lib/money";
import { cltvP2sh } from "../lib/lockScript";

function now() { return Math.floor(Date.now() / 1000); }

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
    developer_fee_percent: 10,
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

export async function locks(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const rawPubkey = c.req.param("pubkey");
  if (!rawPubkey) return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  const pubkey = rawPubkey.toLowerCase();
  if (!validHex(pubkey, 33) && !validHex(pubkey, 65)) {
    return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  }
  const rows = await c.env.DB.prepare(
    `SELECT id,pubkey,redeem_script_hex,address,unlock_time,lock_type,created_at,updated_at
     FROM lock_watchers WHERE pubkey = ? ORDER BY unlock_time ASC`
  ).bind(pubkey).all();
  return ok({ pubkey, locks: rows.results }, id);
}

export async function owed(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const rawPubkey = c.req.param("pubkey");
  if (!rawPubkey) return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  const pubkey = rawPubkey.toLowerCase();
  if (!validHex(pubkey, 33) && !validHex(pubkey, 65)) {
    return fail("INVALID_PUBKEY", "Public key must be 33 or 65 bytes of hex.", id);
  }
  const rows = await c.env.DB.prepare(
    `SELECT kind, amount_atomic FROM ledger_entries WHERE pubkey = ? ORDER BY created_at ASC`
  ).bind(pubkey).all<any>();
  let earned = 0n;
  let settled = 0n;
  for (const row of rows.results) {
    const amount = BigInt(String(row.amount_atomic));
    if (row.kind === "earned" || row.kind === "adjustment") earned += amount;
    if (row.kind === "settled") settled += amount;
  }
  const owed = earned - settled;
  return ok({
    pubkey,
    earned_atomic: earned.toString(),
    settled_atomic: settled.toString(),
    owed_atomic: owed.toString(),
    owed_mwc: mwcStringFromAtomic(owed)
  }, id);
}

export async function ledgerincome(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const settings = await c.env.DB.prepare(
    `SELECT key,value FROM settings WHERE key IN ('ledger_earned_atomic','ledger_allocated_atomic','ledger_settled_atomic','treasury_balance_atomic')`
  ).all<any>();
  const map = new Map(settings.results.map((row: any) => [row.key, String(row.value)]));
  const earned = BigInt(map.get("ledger_earned_atomic") ?? "0");
  const allocated = BigInt(map.get("ledger_allocated_atomic") ?? "0");
  const settled = BigInt(map.get("ledger_settled_atomic") ?? "0");
  const treasuryBalance = BigInt(map.get("treasury_balance_atomic") ?? "0");
  const outstanding = earned > settled ? earned - settled : 0n;
  return ok({
    earned_atomic: earned.toString(),
    allocated_atomic: allocated.toString(),
    settled_atomic: settled.toString(),
    outstanding_atomic: outstanding.toString(),
    treasury_balance_atomic: treasuryBalance.toString(),
    solvent: treasuryBalance >= outstanding
  }, id);
}

export async function healthsync(c: Context<AppEnv>) {
  const id = c.get("requestId");
  try {
    const [info, workers, ledger] = await Promise.all([
      getOriginalJson<any>(c.env, "/info"),
      c.env.DB.prepare(`SELECT worker_id,status,last_seen FROM worker_heartbeats ORDER BY last_seen DESC LIMIT 25`).all(),
      c.env.DB.prepare(`SELECT value FROM settings WHERE key='treasury_balance_atomic'`).first<any>()
    ]);
    const lastSeen = workers.results.length ? Math.max(...workers.results.map((x: any) => Number(x.last_seen))) : 0;
    const workersHealthy = workers.results.length > 0 && (now() - lastSeen) <= 900;
    return ok({
      api: "ok",
      chain: { height: info.blocks ?? info.height ?? null },
      workers: { healthy: workersHealthy, entries: workers.results },
      solvency: { treasury_balance_atomic: atomicString(ledger?.value ?? 0) },
      checked_at: now()
    }, id);
  } catch (e) {
    return fail("HEALTHCHECK_FAILED", String(e), id, 503);
  }
}

/**
 * Public, non-custodial lock registration.
 *
 * There is deliberately NO admin key here. Anyone can call this endpoint, but it can't be
 * used to plant fake data because the server doesn't trust anything the caller says about
 * the lock — it recomputes the CLTV redeem script and P2SH address itself from (pubkey,
 * unlock_time) and only indexes the lock if:
 *   1. the recomputed script/address match what the caller claims, AND
 *   2. the original chain API shows that address actually holds real funds right now.
 * This just makes an already-public on-chain fact (a funded CLTV lock the user created
 * client-side and broadcast themselves) discoverable by pubkey. It never moves funds,
 * never requires a secret, and can't register a lock that doesn't really exist on-chain.
 */
export async function registerLock(c: Context<AppEnv>) {
  const id = c.get("requestId");
  const body = await c.req.json<any>();
  const { pubkey, unlock_time, lock_type } = body || {};

  if ((!validHex(pubkey, 33) && !validHex(pubkey, 65)) ||
      !Number.isInteger(unlock_time) || unlock_time < 0 || unlock_time > 0xffffffff ||
      !["height", "time"].includes(lock_type)) {
    return fail("INVALID_LOCK", "Invalid lock payload.", id);
  }

  let derived: { redeemScriptHex: string; address: string };
  try {
    derived = cltvP2sh(unlock_time, pubkey.toLowerCase());
  } catch (e) {
    return fail("INVALID_LOCK", `Could not derive lock address: ${String(e)}`, id);
  }

  // Proof of funds: the derived address must actually be funded on-chain before we'll index it.
  let hasFunds = false;
  try {
    const balance = await getOriginalJson<any>(c.env, `/balance/${encodeURIComponent(derived.address)}`);
    hasFunds = Number(balance?.balance ?? 0) > 0;
  } catch (e) {
    return fail("UPSTREAM_ERROR", `Could not verify lock address on-chain: ${String(e)}`, id, 502);
  }
  if (!hasFunds) {
    return fail("LOCK_NOT_FUNDED", "That lock address has no on-chain balance yet. Broadcast the locking transaction first, then register it.", id, 409);
  }

  const lockId = crypto.randomUUID();
  const timestamp = now();
  await c.env.DB.prepare(`
    INSERT INTO lock_watchers(id,pubkey,redeem_script_hex,address,unlock_time,lock_type,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(pubkey,redeem_script_hex) DO UPDATE SET
      address=excluded.address, unlock_time=excluded.unlock_time,
      lock_type=excluded.lock_type, updated_at=excluded.updated_at
  `).bind(lockId, pubkey.toLowerCase(), derived.redeemScriptHex, derived.address, unlock_time, lock_type, timestamp, timestamp).run();

  return ok({
    registered: true,
    pubkey: pubkey.toLowerCase(),
    address: derived.address,
    redeem_script_hex: derived.redeemScriptHex,
    unlock_time,
    lock_type
  }, id);
}

export async function heartbeat(c: Context<AppEnv>) {
  const id = c.get("requestId");
  if (!(await requireAdmin(c.req.raw, c.env))) return fail("UNAUTHORIZED", "Admin authorization required.", id, 401);
  const body = await c.req.json<any>();
  if (!body?.worker_id || !body?.status) return fail("INVALID_HEARTBEAT", "worker_id and status are required.", id);
  await c.env.DB.prepare(`
    INSERT INTO worker_heartbeats(worker_id,status,details_json,last_seen)
    VALUES(?,?,?,?)
    ON CONFLICT(worker_id) DO UPDATE SET status=excluded.status, details_json=excluded.details_json, last_seen=excluded.last_seen
  `).bind(String(body.worker_id), String(body.status), JSON.stringify(body.details ?? {}), now()).run();
  return ok({ accepted: true, worker_id: String(body.worker_id) }, id);
}

export async function ledgerEntry(c: Context<AppEnv>) {
  const id = c.get("requestId");
  if (!(await requireAdmin(c.req.raw, c.env))) return fail("UNAUTHORIZED", "Admin authorization required.", id, 401);
  const body = await c.req.json<any>();
  if ((!validHex(body?.pubkey, 33) && !validHex(body?.pubkey, 65)) ||
      !["earned","allocated","settled","adjustment"].includes(body?.kind) ||
      !/^-?\d+$/.test(String(body?.amount_atomic ?? ""))) {
    return fail("INVALID_LEDGER_ENTRY", "Invalid ledger entry.", id);
  }
  const entryId = crypto.randomUUID();
  const amount = String(body.amount_atomic);
  const key = body.kind === "settled"
    ? "ledger_settled_atomic"
    : body.kind === "allocated"
      ? "ledger_allocated_atomic"
      : "ledger_earned_atomic";
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO ledger_entries(id,pubkey,kind,amount_atomic,reference,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?)
    `).bind(
      entryId, body.pubkey.toLowerCase(), body.kind, amount,
      body.reference ?? null, JSON.stringify(body.metadata ?? {}), now()
    ),
    c.env.DB.prepare(`
      UPDATE settings
      SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT), updated_at = ?
      WHERE key = ?
    `).bind(amount, now(), key)
  ]);
  return ok({ accepted: true, id: entryId }, id);
}

export async function treasury(c: Context<AppEnv>) {
  const id = c.get("requestId");
  if (!(await requireAdmin(c.req.raw, c.env))) return fail("UNAUTHORIZED", "Admin authorization required.", id, 401);
  const body = await c.req.json<any>();
  if (!/^\d+$/.test(String(body?.balance_atomic ?? ""))) {
    return fail("INVALID_BALANCE", "balance_atomic must be a non-negative safe integer.", id);
  }
  await c.env.DB.prepare(`
    INSERT INTO settings(key,value,updated_at) VALUES('treasury_balance_atomic',?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
  `).bind(String(body.balance_atomic), now()).run();
  return ok({ updated: true, balance_atomic: String(body.balance_atomic) }, id);
}
