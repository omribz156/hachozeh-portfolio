import { toDecimal } from "../../../shared/decimals";
import { formatPublicVolumeLabel } from "../../../shared/public-volume";

export function formatVolumeLabel(value: ReturnType<typeof toDecimal>): string | null {
  return formatPublicVolumeLabel(value.toNumber());
}

export function parseVolumeDecimal(value: unknown): ReturnType<typeof toDecimal> {
  try {
    return toDecimal(String(value ?? "0"));
  } catch {
    return toDecimal(0);
  }
}
