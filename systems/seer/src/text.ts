export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (normalized.length > 0) {
    return normalized;
  }

  return Array.from(value)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "x")
    .join("_");
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
