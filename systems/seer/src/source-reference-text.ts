export function extractFirstUrl(value: string | undefined): string | null {
  const match = value?.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] ?? null;
}

export function normalizeFingerprintText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[״"]/g, "")
    .replace(/\s+/g, " ");
}

export function normalizeSourceUrlForFingerprint(value: string | undefined): string {
  const url = extractFirstUrl(value);

  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
  }
}
