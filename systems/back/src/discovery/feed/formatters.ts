import { formatPublicVolumeLabel } from "../../shared/public-volume";

const CLOSE_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  timeZone: "Asia/Jerusalem"
});

const UPDATED_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem"
});

export function quantizeProbability(value: string): string {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "0.00000000";
  }

  return numeric.toFixed(8);
}

export function formatProbabilityLabel(value: string): string {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "0%";
  }

  return `${Math.round(numeric * 100)}%`;
}

export function formatVolumeLabel(value: string): string | null {
  return formatPublicVolumeLabel(value);
}

export function formatCloseLabel(value: Date): string {
  return CLOSE_LABEL_FORMATTER.format(value);
}

export function formatUpdatedLabel(value: Date): string {
  return UPDATED_LABEL_FORMATTER.format(value).replace(",", " ·");
}
