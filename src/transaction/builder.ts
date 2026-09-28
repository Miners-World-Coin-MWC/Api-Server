export type Utxo = {
  txid: string;
  vout: number;
  value: number;
  scriptPubKey?: string;
};

export type Output = {
  address?: string;
  script?: string;
  value: number;
};

export type TransactionBuildRequest = {
  utxos: Utxo[];
  outputs: Output[];
  fee: number;
};

export function selectUtxos(
  utxos: Utxo[],
  amount: number,
  fee: number
): { selected: Utxo[]; total: number; change: number } {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive integer in atomic MWC units.");
  }

  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw new Error("Fee must be a non-negative integer in atomic MWC units.");
  }

  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const selected: Utxo[] = [];
  let total = 0;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    if (total >= amount + fee) break;
  }

  if (total < amount + fee) {
    throw new Error("Insufficient funds.");
  }

  return {
    selected,
    total,
    change: total - amount - fee
  };
}
