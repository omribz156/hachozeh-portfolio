export function normalizeOracleLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 100);
}
