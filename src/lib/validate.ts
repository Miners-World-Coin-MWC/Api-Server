export function validBase58ish(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  return /^[1-9A-HJ-NP-Za-km-z]{20,120}$/.test(value);
}

export function validHex(value: string | null | undefined, bytes?: number): value is string {
  if (typeof value !== "string") return false;
  const ok = /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0;
  return ok && (bytes === undefined || value.length === bytes * 2);
}

export function positiveInt(value: string | null | undefined, fallback: number, max: number): number {
  const parsed = value === null || value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid integer parameter");
  return Math.min(parsed, max);
}
