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

const SHOW_OFFICIAL_FETCH_HEADERS = {
  "user-agent": "Hachozeh Oracle official-show adapter"
};

const SHOW_OFFICIAL_ALLOWED_HOSTS = [
  "www.mako.co.il",
  "mako.co.il",
  "www.keshet12.co.il",
  "keshet12.co.il"
];

const ELIMINATION_PATTERNS = [
  /הודח(?:ו|ה)?/i,
  /הזוג\s+המודח/i,
  /סיימ(?:ו|ה|ה)?\s+את\s+דרכ/i,
  /עזב(?:ו|ה)?\s+את\s+התחרות/i,
  /פרש(?:ו|ה)?/i
];

const WINNER_PATTERNS = [
  /זכ(?:ו|תה|ה)\s+(?:בגמר|בתואר|במקום\s+הראשון|בעונה|בתחרות)/i,
  /הוכרז(?:ו|ה)?\s+כזוכ/i,
  /הזוכ(?:ים|ות|ה)\s+הגדול/i,
  /המנצח(?:ים|ת)?\s+של\s+העונה/i,
  /ניצח(?:ו|ה)?\s+בגמר/i
];

type ShowOfficialOutcome = {
  evidenceKey: string;
  winnerLabel: string;
  confidence: "medium" | "high";
  reason: "target_won" | "target_eliminated" | "other_known_candidate_won";
  matchedAlias: string;
  matchedKeyword: string;
};

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function readShowOfficialSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const contractUrl = readContractResolutionSourceUrl(context);

  if (contractUrl) {
    return contractUrl;
  }

  const match = context.resolutionSource.match(/https:\/\/\S+/i);
  return match?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function readNestedString(record: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return readString(current);
}

function readNestedStringArray(record: Record<string, unknown>, path: string[]): string[] {
  let current: unknown = record;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return [];
    }

    current = (current as Record<string, unknown>)[key];
  }

  return readStringArray(current);
}

function unique(values: string[]): string[] {
  return values.filter((value, index, list) => value.trim().length > 0 && list.indexOf(value) === index);
}

function extractTargetLabel(context: OracleLifecycleSourceContext): string | null {
  const contract = context.marketContract as (Record<string, unknown> & { objectType?: string }) | null;
  const explicit = contract
    ? [
        readNestedString(contract, ["targetEntity"]),
        readNestedString(contract, ["targetCandidate"]),
        readNestedString(contract, ["targetOutcomeLabel"]),
        readNestedString(contract, ["displayHints", "targetEntity"]),
        readNestedString(contract, ["displayHints", "targetCandidate"]),
        readNestedString(contract, ["timeline", "targetEntity"]),
        readNestedString(contract, ["timeline", "targetCandidate"])
      ].find((value): value is string => Boolean(value))
    : null;

  if (explicit) {
    return explicit;
  }

  const haystack = [
    context.marketTitle,
    context.marketContract?.measurement,
    context.marketContract?.resolutionRule,
    context.resolutionRules
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const titleMatch =
    haystack.match(/האם\s+(.+?)\s+יזכ(?:ו|ה)\s+/i) ??
    haystack.match(/האם\s+(.+?)\s+ינצח(?:ו|ה)\s+/i);

  return titleMatch?.[1]?.trim() ?? null;
}

function readKnownCandidates(context: OracleLifecycleSourceContext, targetLabel: string | null): string[] {
  const contract = context.marketContract as (Record<string, unknown> & { objectType?: string }) | null;
  const fromContract = contract
    ? [
        ...readNestedStringArray(contract, ["eventCandidates"]),
        ...readNestedStringArray(contract, ["contestants"]),
        ...readNestedStringArray(contract, ["displayHints", "eventCandidates"]),
        ...readNestedStringArray(contract, ["displayHints", "contestants"]),
        ...readNestedStringArray(contract, ["timeline", "eventCandidates"]),
        ...readNestedStringArray(contract, ["timeline", "contestants"])
      ]
    : [];
  const fromOutcomeMap =
    context.marketContract?.resultShape === "multi_outcome"
      ? context.marketContract.outcomeMap?.map((outcome) => outcome.outcomeLabel ?? "").filter(Boolean) ?? []
      : [];

  return unique([targetLabel ?? "", ...fromContract, ...fromOutcomeMap]);
}

function firstName(value: string): string | null {
  const first = value.trim().split(/\s+/)[0]?.trim();
  return first && first.length >= 2 ? first : null;
}

function pairParts(value: string): string[] {
  return value
    .split(/\s+ו(?=\S)|\s+ו\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function aliasesForCandidate(candidate: string): string[] {
  const parts = pairParts(candidate);
  const firstNames = parts.map(firstName).filter((part): part is string => Boolean(part));
  const shortPair = firstNames.length >= 2 ? `${firstNames[0]} ו${firstNames[1]}` : "";

  return unique([candidate, ...parts.filter((part) => part.split(/\s+/).length >= 2), shortPair]);
}

function sentenceAround(text: string, index: number, fallbackRadius = 180): string {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const sentenceStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("\n")
  );
  const afterStops = [after.indexOf("."), after.indexOf("!"), after.indexOf("?"), after.indexOf("\n")]
    .filter((value) => value >= 0)
    .map((value) => index + value);
  const sentenceEnd = afterStops.length > 0 ? Math.min(...afterStops) : -1;

  if (sentenceStart >= 0 || sentenceEnd >= 0) {
    return text.slice(sentenceStart >= 0 ? sentenceStart + 1 : Math.max(0, index - fallbackRadius), sentenceEnd >= 0 ? sentenceEnd : Math.min(text.length, index + fallbackRadius));
  }

  return text.slice(Math.max(0, index - fallbackRadius), Math.min(text.length, index + fallbackRadius));
}

function findPatternNearAlias(text: string, aliases: string[], patterns: RegExp[]): { alias: string; keyword: string } | null {
  const lowerText = text.toLocaleLowerCase("he-IL");

  for (const alias of aliases) {
    const lowerAlias = alias.toLocaleLowerCase("he-IL");
    let index = lowerText.indexOf(lowerAlias);

    while (index >= 0) {
      const window = sentenceAround(text, index);
      const negatedElimination = /לא\s+(?:הודח|הודחה|הודחו|פרש|פרשה|פרשו)/i.test(window);

      for (const pattern of patterns) {
        const match = window.match(pattern);
        if (match && !(patterns === ELIMINATION_PATTERNS && negatedElimination)) {
          return {
            alias,
            keyword: match[0]
          };
        }
      }

      index = lowerText.indexOf(lowerAlias, index + Math.max(1, lowerAlias.length));
    }
  }

  return null;
}

function labelForEvidenceKey(context: OracleLifecycleSourceContext, evidenceKey: string, fallback: string): string {
  const mapped = context.marketContract?.outcomeMap?.find((outcome) => outcome.evidenceKey === evidenceKey);
  return mapped?.outcomeLabel ?? fallback;
}

function evidenceKeyForMultiOutcome(context: OracleLifecycleSourceContext, winnerLabel: string): string | null {
  const aliases = aliasesForCandidate(winnerLabel).map((alias) => alias.toLocaleLowerCase("he-IL"));
  const mapped = context.marketContract?.outcomeMap?.find((outcome) => {
    const label = outcome.outcomeLabel?.toLocaleLowerCase("he-IL") ?? "";
    return aliases.some((alias) => label.includes(alias) || alias.includes(label));
  });

  return mapped?.evidenceKey ?? null;
}

function parseShowOfficialResult(context: OracleLifecycleSourceContext, text: string): ShowOfficialOutcome | null {
  const targetLabel = extractTargetLabel(context);
  const candidates = readKnownCandidates(context, targetLabel);

  if (context.marketContract?.resultShape === "multi_outcome") {
    for (const candidate of candidates) {
      const winnerHit = findPatternNearAlias(text, aliasesForCandidate(candidate), WINNER_PATTERNS);
      if (!winnerHit) continue;

      const evidenceKey = evidenceKeyForMultiOutcome(context, candidate);
      if (!evidenceKey) {
        return null;
      }

      return {
        evidenceKey,
        winnerLabel: candidate,
        confidence: "medium",
        reason: "target_won",
        matchedAlias: winnerHit.alias,
        matchedKeyword: winnerHit.keyword
      };
    }

    return null;
  }

  if (context.marketContract?.resultShape !== "yes_no" || !targetLabel) {
    return null;
  }

  const targetAliases = aliasesForCandidate(targetLabel);
  const targetWinnerHit = findPatternNearAlias(text, targetAliases, WINNER_PATTERNS);
  if (targetWinnerHit) {
    return {
      evidenceKey: "yes",
      winnerLabel: labelForEvidenceKey(context, "yes", "כן"),
      confidence: "medium",
      reason: "target_won",
      matchedAlias: targetWinnerHit.alias,
      matchedKeyword: targetWinnerHit.keyword
    };
  }

  const targetEliminationHit = findPatternNearAlias(text, targetAliases, ELIMINATION_PATTERNS);
  if (targetEliminationHit) {
    return {
      evidenceKey: "no",
      winnerLabel: labelForEvidenceKey(context, "no", "לא"),
      confidence: "high",
      reason: "target_eliminated",
      matchedAlias: targetEliminationHit.alias,
      matchedKeyword: targetEliminationHit.keyword
    };
  }

  for (const candidate of candidates.filter((candidate) => candidate !== targetLabel)) {
    const otherWinnerHit = findPatternNearAlias(text, aliasesForCandidate(candidate), WINNER_PATTERNS);
    if (!otherWinnerHit) continue;

    return {
      evidenceKey: "no",
      winnerLabel: labelForEvidenceKey(context, "no", "לא"),
      confidence: "medium",
      reason: "other_known_candidate_won",
      matchedAlias: otherWinnerHit.alias,
      matchedKeyword: otherWinnerHit.keyword
    };
  }

  return null;
}

async function inspectShowOfficialResolution(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readShowOfficialSourceUrl(context);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "show_official",
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {},
      claimSummary: "No official show source URL found.",
      confidence: "low",
      blockers: ["missing_show_official_source_url"]
    };
  }

  const html = await (
    fetchers.fetchText ??
    ((url) => fetchOracleAdapterText(url, {
      headers: SHOW_OFFICIAL_FETCH_HEADERS,
      allowedHosts: SHOW_OFFICIAL_ALLOWED_HOSTS
    }))
  )(sourceUrl);
  const text = stripHtml(html);
  const parsed = parseShowOfficialResult(context, text);
  const targetLabel = extractTargetLabel(context);
  const candidates = readKnownCandidates(context, targetLabel);

  if (!parsed) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: "show_official",
      sourceUrl,
      status: "not_started",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(html),
      normalizedSnapshot: {
        sourceFamily: "show_official",
        sourceUrl,
        targetLabel,
        candidateCount: candidates.length,
        evidenceKey: null,
        winnerLabel: null,
        textPreview: text.slice(0, 500)
      },
      claimSummary: "Official show source does not yet show a parseable winner or elimination result.",
      confidence: "medium",
      blockers: []
    };
  }

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "show_official",
    sourceUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: parsed.evidenceKey,
    winnerKind: "named",
    winnerLabel: parsed.winnerLabel,
    fetchedAt,
    rawHash: hashRawSnapshot(html),
    normalizedSnapshot: {
      sourceFamily: "show_official",
      sourceUrl,
      targetLabel,
      candidateCount: candidates.length,
      evidenceKey: parsed.evidenceKey,
      winnerLabel: parsed.winnerLabel,
      reason: parsed.reason,
      matchedAlias: parsed.matchedAlias,
      matchedKeyword: parsed.matchedKeyword,
      textPreview: text.slice(0, 500)
    },
    claimSummary: `Official show source parsed ${parsed.reason}; contract outcome maps to ${parsed.winnerLabel} (${parsed.evidenceKey}).`,
    confidence: parsed.confidence,
    blockers: []
  };
}

async function inspectUnsupportedCloseCondition(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readShowOfficialSourceUrl(context) ?? "";

  return {
    objectType: "oracle_source_inspection",
    sourceFamily: "show_official",
    sourceUrl,
    status: "unknown",
    closeConditionSatisfied: false,
    resolutionAvailable: false,
    fetchedAt,
    rawHash: hashRawSnapshot(sourceUrl),
    normalizedSnapshot: {
      sourceFamily: "show_official",
      sourceUrl
    },
    claimSummary: "Official show adapter supports final resolution only; close remains scheduled or operator-gated.",
    confidence: "low",
    blockers: ["show_official_close_condition_not_supported"]
  };
}

export const SHOW_OFFICIAL_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: "show_official",
  sourceLabel: "Official show page",
  sourceIds: ["src_show_official"],
  measurementKinds: ["final_winner"],
  resultShapes: ["yes_no", "multi_outcome"],
  routes: [
    { measurementKind: "final_winner", resultShape: "yes_no" },
    { measurementKind: "final_winner", resultShape: "multi_outcome" }
  ],
  capabilities: {
    closeCondition: false,
    resolution: true
  },
  supportsSource: (context) =>
    readContractSourceIds(context).includes("src_show_official") ||
    Boolean(readShowOfficialSourceUrl(context)?.match(/^https:\/\/(?:www\.)?(?:mako\.co\.il|keshet12\.co\.il)\//i)),
  inspectCloseCondition: inspectUnsupportedCloseCondition,
  inspectResolution: inspectShowOfficialResolution
};
