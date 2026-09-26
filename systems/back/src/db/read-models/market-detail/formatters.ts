const CLOSE_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  timeZone: "Asia/Jerusalem"
});

const UPDATED_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem"
});

const CHART_TIME_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem"
});

const CHART_DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Jerusalem"
});

const TIMELINE_LABEL_FORMATTER = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jerusalem"
});

export function formatCloseLabel(value: Date): string {
  return CLOSE_LABEL_FORMATTER.format(value);
}

export function formatUpdatedLabel(value: Date): string {
  return UPDATED_LABEL_FORMATTER.format(value).replace(",", " ·");
}

function formatChartPointLabel(value: Date, rangeId: string): string {
  if (rangeId === "1H" || rangeId === "6H" || rangeId === "1D") {
    return CHART_TIME_LABEL_FORMATTER.format(value);
  }

  return CHART_DATE_LABEL_FORMATTER.format(value);
}

export function formatTimelineLabel(value: Date): string {
  return TIMELINE_LABEL_FORMATTER.format(value).replace(",", " ·");
}

function toUnixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}
