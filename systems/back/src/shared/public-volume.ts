const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1
});

// Cold-start presentation floor: sub-floor trade volumes read as noise, not
// signal, so we omit the label entirely rather than render "V₪ 0" across
// pages/meta/OG/RSS/JSON-LD. Per workspace/reports/fable/ux-cold-start-audit.md
// (decided 2026-07-02). DELETABLE — remove or lower once median active-market
// volume clears ~5x the floor.
const parsedFloor = Number.parseInt(process.env.PUBLIC_VOLUME_FLOOR ?? "", 10);
export const PUBLIC_VOLUME_FLOOR = Number.isFinite(parsedFloor) ? parsedFloor : 100;

export function formatPublicVolumeLabel(value: string | number): string | null {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric) || numeric < PUBLIC_VOLUME_FLOOR) {
    return null;
  }

  if (numeric < 1000) {
    return `V₪ ${numeric.toFixed(0)}`;
  }

  return `V₪ ${COMPACT_NUMBER_FORMATTER.format(numeric)}`;
}
