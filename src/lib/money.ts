export function atomicString(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Unsafe monetary integer received from upstream");
    }
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  return "0";
}

export function mwcStringFromAtomic(value: bigint): string {
  const negative = value < 0n;
  const n = negative ? -value : value;
  const whole = n / 100000000n;
  const fraction = (n % 100000000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
