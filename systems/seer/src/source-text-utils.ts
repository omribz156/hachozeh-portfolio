import { compactWhitespace, decodeHtmlEntities, stripHtmlTags } from "./text";

export function extractXmlTag(block: string, tagName: string): string | undefined {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  const value = match?.[1];

  if (!value) {
    return undefined;
  }

  return compactWhitespace(stripHtmlTags(decodeHtmlEntities(value)));
}

export function toIsoDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
}

export function toIsoDateFromDayMonthYear(value: string): string {
  const normalized = compactWhitespace(value);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return toIsoDate(normalized);
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

export function titleCaseDate(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function toMonthDayYearLabelFromDayMonthYear(value: string): string | undefined {
  const normalized = compactWhitespace(value);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return undefined;
  }

  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function formatEnglishDateFromDayMonthYear(value: string): string | undefined {
  return toMonthDayYearLabelFromDayMonthYear(value);
}

export function formatHebrewDateFromDayMonthYear(value: string): string | undefined {
  const iso = toIsoDateFromDayMonthYear(value);
  const parsed = new Date(iso);

  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  });
}

export function formatHebrewFullDateFromIso(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function isWithinLookback(
  observedAt: string,
  generatedAt: string,
  lookbackDays: number
): boolean {
  const observedTime = new Date(observedAt).getTime();
  const generatedTime = new Date(generatedAt).getTime();

  if (Number.isNaN(observedTime) || Number.isNaN(generatedTime)) {
    return true;
  }

  return generatedTime - observedTime <= lookbackDays * 24 * 60 * 60 * 1000;
}

export function toSummary(prefix: string, body?: string): string {
  const cleanBody = compactWhitespace(body ?? "");

  if (cleanBody.length === 0) {
    return prefix;
  }

  if (cleanBody.length <= 220) {
    return `${prefix} ${cleanBody}`.trim();
  }

  return `${prefix} ${cleanBody.slice(0, 217).trimEnd()}...`.trim();
}
