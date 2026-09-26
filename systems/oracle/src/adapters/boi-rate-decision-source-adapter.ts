import {
  defaultFetchedAt,
  fetchOracleAdapterText,
  hashRawSnapshot,
  readContractResolutionSourceUrl,
  readContractSourceIds,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

const BOI_RATE_DECISION_FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,he;q=0.8",
  "cache-control": "no-cache",
  "user-agent":
    "Mozilla/5.0 (compatible; HachozehOracle/1.0; +https://hachozeh.com)"
};
const BOI_RATE_DECISION_ALLOWED_HOSTS = ["www.boi.org.il"];
const BOI_MONETARY_POLICY_URL = "https://www.boi.org.il/en/economic-roles/monetary-policy/";
const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBoiUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(decodeHtml(href), baseUrl);

    if (!BOI_RATE_DECISION_ALLOWED_HOSTS.includes(url.hostname)) {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const linkPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html))) {
    const url = normalizeBoiUrl(match[2] ?? "", baseUrl);

    if (!url) {
      continue;
    }

    links.push({
      url,
      text: decodeHtml(stripHtml(match[3] ?? ""))
    });
  }

  return links;
}

function readBoiSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const contractUrl = readContractResolutionSourceUrl(context);

  if (contractUrl) {
    return contractUrl;
  }

  const match = context.resolutionSource.match(/https:\/\/www\.boi\.org\.il\/\S+/i);
  return match?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return [
    String(year).padStart(4, "0"),
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function readTargetDateIso(context: OracleLifecycleSourceContext): string | null {
  const dateValue = context.marketContract?.timeline?.closeAt ?? context.closeAt;
  const parsed = dateValue ? new Date(dateValue) : null;

  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function readDateIsoFromText(value: string): string | null {
  const normalized = decodeHtml(value);
  const slashDate = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);

  if (slashDate) {
    return isoDate(Number(slashDate[3]), Number(slashDate[2]) - 1, Number(slashDate[1]));
  }

  const dashedDate = normalized.match(/\b(\d{1,2})-(\d{1,2})-(20\d{2})\b/);

  if (dashedDate) {
    return isoDate(Number(dashedDate[3]), Number(dashedDate[2]) - 1, Number(dashedDate[1]));
  }

  const monthDate = normalized.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2})\b/i
  );

  if (monthDate) {
    return isoDate(Number(monthDate[3]), MONTH_INDEX[monthDate[1].toLowerCase()], Number(monthDate[2]));
  }

  return null;
}

function readRatePercent(value: string): number | null {
  const normalized = decodeHtml(value);
  const match = normalized.match(
    /\b(?:to|at|ל(?:רמה|שיעור)\s+של)\s*(\d+(?:\.\d+)?)\s*(?:percent|%|אחוז)/i
  );

  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBoiRateDecisionText(value: string): boolean {
  return includesAny(value, [
    /החלטת\s+הריבית/i,
    /הוועדה\s+המוניטרית/i,
    /interest\s+rate\s+decision/i,
    /monetary\s+committee/i,
    /interest\s+rate/i
  ]);
}

function readMoveSizeFromRateDelta(delta: number): "025" | "050-plus" | null {
  const absDelta = Math.abs(delta);

  if (absDelta >= 0.495) {
    return "050-plus";
  }

  if (absDelta >= 0.245 && absDelta < 0.495) {
    return "025";
  }

  return null;
}

type BoiDecisionCandidate = {
  url: string;
  text: string;
  dateIso: string | null;
  rate: number | null;
};

function collectDecisionCandidates(html: string, baseUrl: string): BoiDecisionCandidate[] {
  const candidates = extractLinks(html, baseUrl)
    .filter((link) => isBoiRateDecisionText(`${link.text} ${link.url}`))
    .map((link) => ({
      url: link.url,
      text: link.text,
      dateIso: readDateIsoFromText(`${link.text} ${link.url}`),
      rate: readRatePercent(link.text)
    }));

  const unique = new Map<string, BoiDecisionCandidate>();

  for (const candidate of candidates) {
    unique.set(candidate.url, candidate);
  }

  return [...unique.values()];
}

function findPreviousDecisionRate(
  candidates: BoiDecisionCandidate[],
  targetDateIso: string | null
): number | null {
  if (!targetDateIso) {
    return null;
  }

  const targetTime = Date.parse(`${targetDateIso}T00:00:00.000Z`);

  return (
    candidates
      .filter((candidate) => candidate.dateIso && candidate.rate != null)
      .map((candidate) => ({
        ...candidate,
        time: Date.parse(`${candidate.dateIso}T00:00:00.000Z`)
      }))
      .filter((candidate) => Number.isFinite(candidate.time) && candidate.time < targetTime)
      .sort((left, right) => right.time - left.time)[0]?.rate ?? null
  );
}

function isExactPressReleaseUrl(url: string): boolean {
  return /\/communication-and-publications\/press-releases\//i.test(url);
}

function isBoiFetchChallenge(text: string): boolean {
  return /Radware Page|Verifying your browser|validate\.perfdrive\.com|stormcaster\.js/i.test(text);
}

function includesAny(value: string, needles: RegExp[]): boolean {
  return needles.some((needle) => needle.test(value));
}

function readMoveSizeKey(value: string): "025" | "050-plus" | null {
  if (/(0\.5|0\.50|50\s*(?:bp|basis|נק)|חצי)/i.test(value)) {
    return "050-plus";
  }

  if (/(0\.25|25\s*(?:bp|basis|נק)|רבע)/i.test(value)) {
    return "025";
  }

  return null;
}

function formatMoveWinnerLabel(direction: "cut" | "hike", sizeKey: "025" | "050-plus" | null): string {
  const labels = {
    cut: {
      "050-plus": "ירידה 0.50%+",
      "025": "ירידה 0.25%",
      default: "ירידה"
    },
    hike: {
      "050-plus": "עלייה 0.50%+",
      "025": "עלייה 0.25%",
      default: "עלייה"
    }
  } as const;

  return sizeKey ? labels[direction][sizeKey] : labels[direction].default;
}

function parseBoiRateDecision(text: string): {
  evidenceKey: string;
  winnerLabel: string;
  confidence: "medium" | "high";
} | null;
function parseBoiRateDecision(
  text: string,
  previousRate: number | null
): {
  evidenceKey: string;
  winnerLabel: string;
  confidence: "medium" | "high";
} | null;
function parseBoiRateDecision(
  text: string,
  previousRate: number | null = null
): {
  evidenceKey: string;
  winnerLabel: string;
  confidence: "medium" | "high";
} | null {
  const hasDecisionLanguage = includesAny(text, [
    /החלטת\s+הריבית/i,
    /הוועדה\s+המוניטרית/i,
    /interest\s+rate\s+decision/i,
    /monetary\s+committee/i
  ]);

  if (!hasDecisionLanguage) {
    return null;
  }

  if (includesAny(text, [/ללא\s+שינוי/i, /unchanged/i, /leave[s]?\s+.*interest\s+rate/i, /keep[s]?\s+.*interest\s+rate/i])) {
    return {
      evidenceKey: "hold",
      winnerLabel: "ללא שינוי",
      confidence: "high"
    };
  }

  if (includesAny(text, [/הוריד/i, /הפחית/i, /ירד/i, /lower/i, /cut/i, /decreas/i, /reduc/i])) {
    const currentRate = readRatePercent(text);
    const sizeKey =
      readMoveSizeKey(text) ??
      (currentRate != null && previousRate != null
        ? readMoveSizeFromRateDelta(currentRate - previousRate)
        : null);

    return {
      evidenceKey: sizeKey ? `cut-${sizeKey}` : "cut",
      winnerLabel: formatMoveWinnerLabel("cut", sizeKey),
      confidence: sizeKey ? "high" : "medium"
    };
  }

  if (includesAny(text, [/העלה/i, /להעלות/i, /עלתה/i, /עלייה/i, /raise/i, /hike/i, /increas/i])) {
    const currentRate = readRatePercent(text);
    const sizeKey =
      readMoveSizeKey(text) ??
      (currentRate != null && previousRate != null
        ? readMoveSizeFromRateDelta(currentRate - previousRate)
        : null);

    return {
      evidenceKey: sizeKey ? `hike-${sizeKey}` : "hike",
      winnerLabel: formatMoveWinnerLabel("hike", sizeKey),
      confidence: sizeKey ? "high" : "medium"
    };
  }

  return null;
}

async function readBoiDecisionDocument(
  sourceUrl: string,
  targetDateIso: string | null,
  fetchText: (url: string) => Promise<string>
): Promise<{
  sourceUrl: string;
  html: string;
  text: string;
  previousRate: number | null;
  candidates: BoiDecisionCandidate[];
}> {
  const sourceHtml = await fetchText(sourceUrl);
  const sourceText = stripHtml(sourceHtml);
  let candidates = collectDecisionCandidates(sourceHtml, sourceUrl);

  if (!isExactPressReleaseUrl(sourceUrl)) {
    try {
      const policyHtml = await fetchText(BOI_MONETARY_POLICY_URL);
      candidates = [...candidates, ...collectDecisionCandidates(policyHtml, BOI_MONETARY_POLICY_URL)];
    } catch {
      // The primary source may still be enough; do not turn a fallback fetch miss into a blocker.
    }
  }

  const previousRate = findPreviousDecisionRate(candidates, targetDateIso);
  const exactCandidate = targetDateIso
    ? candidates.find((candidate) => candidate.dateIso === targetDateIso)
    : null;

  if (exactCandidate) {
    const html = await fetchText(exactCandidate.url);

    return {
      sourceUrl: exactCandidate.url,
      html,
      text: stripHtml(html),
      previousRate,
      candidates
    };
  }

  const sourceDateIso = readDateIsoFromText(`${sourceText} ${sourceUrl}`);

  if (isExactPressReleaseUrl(sourceUrl) && (!targetDateIso || sourceDateIso === targetDateIso)) {
    return {
      sourceUrl,
      html: sourceHtml,
      text: sourceText,
      previousRate,
      candidates
    };
  }

  if (targetDateIso && sourceDateIso === targetDateIso && isBoiRateDecisionText(sourceText)) {
    return {
      sourceUrl,
      html: sourceHtml,
      text: sourceText,
      previousRate,
      candidates
    };
  }

  return {
    sourceUrl,
    html: sourceHtml,
    text: sourceText,
    previousRate,
    candidates
  };
}

function asksWhetherRateStayedUnchanged(context: OracleLifecycleSourceContext): boolean {
  const contract = context.marketContract;

  if (contract?.resultShape !== "yes_no") {
    return false;
  }

  const haystack = [
    contract.measurement,
    context.marketTitle,
    context.resolutionRules,
    contract.resolutionRule,
    (contract as { ambiguityPolicy?: unknown }).ambiguityPolicy
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return /(?:ללא\s+שינוי|ישאיר|תישאר|unchanged|hold)/i.test(haystack);
}

function normalizeBoiResultForContract(
  parsed: {
    evidenceKey: string;
    winnerLabel: string;
    confidence: "medium" | "high";
  },
  context: OracleLifecycleSourceContext
): {
  evidenceKey: string;
  winnerLabel: string;
  confidence: "medium" | "high";
} {
  if (!asksWhetherRateStayedUnchanged(context)) {
    return parsed;
  }

  const isHold = parsed.evidenceKey === "hold";

  return {
    evidenceKey: isHold ? "yes" : "no",
    winnerLabel: isHold ? "כן" : "לא",
    confidence: parsed.confidence
  };
}

async function inspectBoiRateDecision(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readBoiSourceUrl(context);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "boi_rate_decision",
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No Bank of Israel official source URL found.",
      confidence: "low",
      blockers: ["missing_boi_source_url"]
    };
  }

  const fetchText =
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: BOI_RATE_DECISION_FETCH_HEADERS,
      allowedHosts: BOI_RATE_DECISION_ALLOWED_HOSTS
    }));
  const targetDateIso = readTargetDateIso(context);
  const decision = await readBoiDecisionDocument(sourceUrl, targetDateIso, fetchText);
  const textDateIso = readDateIsoFromText(`${decision.text} ${decision.sourceUrl}`);

  if (isBoiFetchChallenge(decision.html) || isBoiFetchChallenge(decision.text)) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "boi_rate_decision",
      sourceUrl: decision.sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(decision.html),
      normalizedSnapshot: {
        sourceFamily: "boi_rate_decision",
        sourceUrl: decision.sourceUrl,
        targetDateIso,
        sourceDateIso: textDateIso,
        previousRate: decision.previousRate,
        discoveredCandidateCount: decision.candidates.length,
        fetchBlocked: true,
        blocker: "boi_waf_challenge",
        textPreview: decision.text.slice(0, 500)
      },
      claimSummary: "Bank of Israel official source returned a browser-verification challenge instead of parseable decision content.",
      confidence: "low",
      blockers: ["boi_waf_challenge"]
    };
  }

  const parsed =
    !targetDateIso || textDateIso === targetDateIso
      ? parseBoiRateDecision(decision.text, decision.previousRate)
      : null;

  if (!parsed) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "boi_rate_decision",
      sourceUrl: decision.sourceUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(decision.html),
      normalizedSnapshot: {
        sourceFamily: "boi_rate_decision",
        sourceUrl: decision.sourceUrl,
        targetDateIso,
        sourceDateIso: textDateIso,
        previousRate: decision.previousRate,
        discoveredCandidateCount: decision.candidates.length,
        rawEvidenceKey: null,
        rawWinnerLabel: null,
        evidenceKey: null,
        winnerLabel: null,
        textPreview: decision.text.slice(0, 500)
      },
      claimSummary: "Bank of Israel official source does not yet show a parseable final rate decision.",
      confidence: "medium",
      blockers: []
    };
  }

  const normalizedParsed = normalizeBoiResultForContract(parsed, context);
  const normalizedSnapshot = {
    sourceFamily: "boi_rate_decision",
    sourceUrl: decision.sourceUrl,
    targetDateIso,
    sourceDateIso: textDateIso,
    previousRate: decision.previousRate,
    rawEvidenceKey: parsed.evidenceKey,
    rawWinnerLabel: parsed.winnerLabel,
    evidenceKey: normalizedParsed.evidenceKey,
    winnerLabel: normalizedParsed.winnerLabel,
    textPreview: decision.text.slice(0, 500)
  };

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "boi_rate_decision",
    sourceUrl: decision.sourceUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: normalizedParsed.evidenceKey,
    winnerKind: "named",
    winnerLabel: normalizedParsed.winnerLabel,
    fetchedAt,
    rawHash: hashRawSnapshot(decision.html),
    normalizedSnapshot,
    claimSummary: `Bank of Israel official rate decision parsed as ${parsed.winnerLabel} (${parsed.evidenceKey}); contract outcome maps to ${normalizedParsed.winnerLabel} (${normalizedParsed.evidenceKey}).`,
    confidence: normalizedParsed.confidence,
    blockers: []
  };
}

export const BOI_RATE_DECISION_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "boi_rate_decision",
  sourceLabel: "Bank of Israel official rate decision",
  sourceIds: ["src_boi_announcements"],
  measurementKinds: ["rate_direction"],
  resultShapes: ["cut_hold_hike", "yes_no"],
  routes: [
    { measurementKind: "rate_direction", resultShape: "cut_hold_hike" },
    { measurementKind: "rate_direction", resultShape: "yes_no" }
  ],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_boi_announcements") ||
    Boolean(readBoiSourceUrl(context)),
  inspectCloseCondition: inspectBoiRateDecision,
  inspectResolution: inspectBoiRateDecision
};
