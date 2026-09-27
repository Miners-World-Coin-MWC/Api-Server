export function validBase58ish(value: string | undefined): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{20,120}$/.test(value);
}

export function validHex(value: string | undefined, bytes?: number): boolean {
  const ok = /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0;
  return ok && (bytes === undefined || value.length === bytes * 2);
}

export function positiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = value === null ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid integer parameter");
  return Math.min(parsed, max);
}
