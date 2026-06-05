/**
 * Focus values from the camera driver are LONG integers; IPC carries them as doubles.
 * Use truncation toward zero (same idea as `(long)x` for in-range positives) so we
 * never depend on Math.round() edge cases near .5.
 */
export function toFocusLong(value: unknown, fallback: number): number {
  const x = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(x)) {
    return Math.trunc(Number.isFinite(fallback) ? fallback : 0);
  }
  return Math.trunc(x);
}

export function clampFocusLong(n: number, min: number, max: number): number {
  const nt = Math.trunc(n);
  const lo = Math.trunc(min);
  const hi = Math.trunc(max);
  if (lo > hi) {
    return nt;
  }
  return Math.min(hi, Math.max(lo, nt));
}
