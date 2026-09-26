import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type ExistingMarketLike = {
  id: string;
  title: string;
  eventSlug?: string | null;
  candidateMarketId?: string | null;
  closeAt?: string | null;
  resolvedAt?: string | null;
  winningOutcomeLabels?: string[];
  contract?: JsonRecord | null;
  status?: string | null;
};

export type TournamentChildLike = {
  marketId: string;
  title: string;
  eventChildLabel?: string | null;
  status: string;
  resolvedAt?: string | null;
  winnerCount?: number;
  closeAt?: string | null;
  contract?: JsonRecord | null;
};

export type TournamentEventLike = {
  id: string;
  slug: string | null;
  title: string;
  categoryKey?: string | null;
  children: TournamentChildLike[];
};

export type SeerOpportunityOutcomeSource = {
  fromMarketId: string;
  role?: string;
  fallbackLabel?: string;
};

export type SeerOpportunityObservation = {
  objectType?: "seer_opportunity_observation";
  detector?: string;
  sourceFamily: string;
  sourceUrl: string;
  opportunityType: "match_winner";
  categoryKey?: string;
  title?: string;
  titleTemplate?: string;
  candidateMarketId?: string;
  eventSlug?: string;
  closeAt?: string;
  expectedResolutionAt?: string;
  outcomes?: string[];
  outcomeSources?: SeerOpportunityOutcomeSource[];
  sourceIds?: string[];
  confidence?: "low" | "medium" | "high";
  reason?: string;
};

export type SeerOpportunityMarketDraftSeed = {
  objectType: "seer_opportunity_market_draft_seed";
  status: "needs_official_fixture";
  title: string;
  description: string;
  candidateMarketId: string;
  eventSlug: string;
  categoryKey: string;
  outcomes: string[];
  seededFromMarketIds: string[];
  reviewBlockers: string[];
  marketContract: JsonRecord;
};

export type SeerOpportunitySuggestion = {
  objectType: "seer_opportunity_suggestion";
  id: string;
  source: "tournament_two_left" | "resolved_match_pair" | "source_observation" | "composed_source_observation";
  opportunityType: "match_winner";
  status: "suggested" | "duplicate";
  title: string;
  candidateMarketId: string;
  eventSlug: string;
  categoryKey: string;
  closeAt: string | null;
  expectedResolutionAt: string | null;
  outcomes: string[];
  sourceUrl: string | null;
  sourceIds: string[];
  confidence: "low" | "medium" | "high";
  reason: string;
  duplicateOf: string[];
  suggestedHumanPrompt: string;
  suggestedMarketDraft?: SeerOpportunityMarketDraftSeed;
};

export type SeerOpportunityScanReceipt = {
  objectType: "seer_opportunity_watch_receipt";
  generatedAt: string;
  eventCount: number;
  observationCount: number;
  existingMarketCount: number;
  suggestionCount: number;
  duplicateCount: number;
  suggestions: SeerOpportunitySuggestion[];
};

const TERMINAL_STATUSES = new Set(["resolved", "voided"]);

function readObject(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const part of path) {
    const object = readObject(current);
    if (!object) return null;
    current = object[part];
  }
  return current;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter(Boolean)
    : [];
}

export function normalizeOpportunityText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[״׳'"]/g, "")
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugPart(value: string, fallback: string): string {
  const slug = normalizeOpportunityText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function childEntityLabel(child: TournamentChildLike): string {
  const contract = child.contract ?? {};
  return (
    readString(readPath(contract, ["timeline", "targetEntity"])) ||
    readString(readPath(contract, ["displayHints", "targetEntity"])) ||
    readString(readPath(contract, ["operational", "wimbledonPlayerName"])) ||
    child.eventChildLabel?.trim() ||
    child.title.trim()
  );
}

function childAliases(child: TournamentChildLike): string[] {
  const contract = child.contract ?? {};
  return unique([
    child.marketId,
    child.title,
    child.eventChildLabel ?? "",
    childEntityLabel(child),
    ...readStringArray(readPath(contract, ["taxonomy", "aliases"])),
    readString(readPath(contract, ["operational", "entityKey"])),
    readString(readPath(contract, ["dependencyResolution", "entityKey"])),
    readString(readPath(contract, ["operational", "wimbledonPlayerName"]))
  ]);
}

function isTournamentWinnerChild(child: TournamentChildLike): boolean {
  const contract = child.contract ?? {};
  return (
    readString(contract.marketKindId) === "sports.tournament-winner" ||
    readString(readPath(contract, ["taxonomy", "family"])) === "sports-tournament-winner" ||
    readString(readPath(contract, ["operational", "eventPack"])).includes("wimbledon") ||
    readString(readPath(contract, ["operational", "eventPack"])).includes("fifa-world-cup-2026-winner")
  );
}

function activeUnresolvedTournamentChildren(event: TournamentEventLike): TournamentChildLike[] {
  return event.children.filter((child) => {
    if (!isTournamentWinnerChild(child)) return false;
    if (TERMINAL_STATUSES.has(child.status)) return false;
    if (child.resolvedAt) return false;
    if ((child.winnerCount ?? 0) > 0) return false;
    return true;
  });
}

function pairKey(outcomes: string[]): string {
  return outcomes.map(normalizeOpportunityText).sort().join("|");
}

function marketSearchHaystack(market: ExistingMarketLike): string {
  const contract = market.contract ?? {};
  return [
    market.id,
    market.title,
    market.eventSlug ?? "",
    market.candidateMarketId ?? "",
    readString(contract.marketKindId),
    readString(readPath(contract, ["trustDisplayUrl"])),
    readString(readPath(contract, ["resolutionSource", "url"])),
    readString(readPath(contract, ["operational", "candidateMarketId"])),
    ...readStringArray(readPath(contract, ["taxonomy", "aliases"])),
    ...readStringArray(readPath(contract, ["taxonomy", "entities"])),
    ...readStringArray(readPath(contract, ["taxonomy", "sourceIds"]))
  ]
    .map(normalizeOpportunityText)
    .join(" ");
}

function isLikelyMatchMarket(market: ExistingMarketLike): boolean {
  const contract = market.contract ?? {};
  const marketKindId = readString(contract.marketKindId);
  const resultShape = readString(contract.resultShape);
  const sourceIds = readStringArray(readPath(contract, ["resolutionSource", "sourceIds"]));
  return (
    marketKindId === "sports.game-winner" ||
    resultShape === "home_away_winner" ||
    resultShape === "three_way_result" ||
    sourceIds.includes("src_fifa_match_centre") ||
    sourceIds.includes("src_wimbledon_official")
  );
}

type BracketMatchFeeder = {
  market: ExistingMarketLike;
  groupKey: string;
  sourceFamily: string;
  competitionLabel: string;
  stageLabel: string;
  closeAt: string;
  closeAtMs: number;
  sourceIds: string[];
};

function isResolvedMarket(market: ExistingMarketLike): boolean {
  return Boolean(market.resolvedAt) || market.status === "resolved";
}

function sourceFamilyForIds(sourceIds: string[]): string {
  if (sourceIds.includes("src_fifa_match_centre")) return "fifa-match-centre";
  if (sourceIds.includes("src_wimbledon_official")) return "wimbledon-official";
  return sourceIds[0] ?? "sports-match";
}

function isBracketFeederStage(stageLabel: string): boolean {
  const normalized = normalizeOpportunityText(stageLabel);
  return [
    "round of 16",
    "last 16",
    "quarter",
    "semi",
    "שמינית",
    "רבע",
    "חצי"
  ].some((part) => normalized.includes(part));
}

function bracketMatchFeeder(market: ExistingMarketLike): BracketMatchFeeder | null {
  if (!isLikelyMatchMarket(market)) return null;

  const contract = market.contract ?? {};
  const sourceIds = unique([
    ...readStringArray(readPath(contract, ["resolutionSource", "sourceIds"])),
    ...readStringArray(readPath(contract, ["taxonomy", "sourceIds"]))
  ]);
  const stageLabel =
    readString(readPath(contract, ["displayHints", "stageLabel"])) ||
    readString(readPath(contract, ["timeline", "stageLabel"]));
  const competitionLabel =
    readString(readPath(contract, ["displayHints", "competitionLabel"])) ||
    readString(readPath(contract, ["taxonomy", "competition"])) ||
    readString(readPath(contract, ["operational", "eventPack"]));
  const closeAt = market.closeAt ?? readString(readPath(contract, ["timeline", "closeAt"]));
  const closeAtMs = Date.parse(closeAt);

  if (!stageLabel || !competitionLabel || !Number.isFinite(closeAtMs)) return null;
  if (!isBracketFeederStage(stageLabel)) return null;

  const sourceFamily = sourceFamilyForIds(sourceIds);
  const groupKey = [
    sourceFamily,
    normalizeOpportunityText(competitionLabel),
    normalizeOpportunityText(stageLabel)
  ].join("|");

  return {
    market,
    groupKey,
    sourceFamily,
    competitionLabel,
    stageLabel,
    closeAt,
    closeAtMs,
    sourceIds
  };
}

export function findOpportunityDuplicates(
  opportunity: Pick<SeerOpportunitySuggestion, "candidateMarketId" | "eventSlug" | "outcomes" | "sourceUrl">,
  existingMarkets: ExistingMarketLike[]
): string[] {
  const candidateId = normalizeOpportunityText(opportunity.candidateMarketId);
  const eventSlug = normalizeOpportunityText(opportunity.eventSlug);
  const normalizedSourceUrl = normalizeOpportunityText(opportunity.sourceUrl ?? "");
  const normalizedOutcomes = opportunity.outcomes.map(normalizeOpportunityText).filter(Boolean);

  return existingMarkets
    .filter((market) => {
      if (normalizeOpportunityText(market.candidateMarketId ?? "") === candidateId) return true;
      if (normalizeOpportunityText(market.id).includes(candidateId)) return true;
      if (normalizeOpportunityText(market.eventSlug ?? "") === eventSlug) return true;
      if (normalizedSourceUrl && marketSearchHaystack(market).includes(normalizedSourceUrl)) return true;
      if (!isLikelyMatchMarket(market)) return false;
      const haystack = marketSearchHaystack(market);
      return normalizedOutcomes.length >= 2 && normalizedOutcomes.every((outcome) => haystack.includes(outcome));
    })
    .map((market) => market.id);
}

function findExistingMarketByRef(ref: string, existingMarkets: ExistingMarketLike[]): ExistingMarketLike | null {
  const normalizedRef = normalizeOpportunityText(ref);
  return existingMarkets.find((market) => {
    const contract = market.contract ?? {};
    return [
      market.id,
      market.candidateMarketId ?? "",
      readString(readPath(contract, ["operational", "candidateMarketId"]))
    ].map(normalizeOpportunityText).includes(normalizedRef);
  }) ?? null;
}

function winnerLabelsForMarket(market: ExistingMarketLike): string[] {
  const contract = market.contract ?? {};
  return unique([
    ...(market.winningOutcomeLabels ?? []),
    readString(readPath(contract, ["operational", "winningOutcomeLabel"])),
    ...readStringArray(readPath(contract, ["operational", "winningOutcomeLabels"]))
  ]);
}

function resolveObservationOutcomes(
  observation: SeerOpportunityObservation,
  existingMarkets: ExistingMarketLike[]
): string[] {
  const explicitOutcomes = unique(observation.outcomes ?? []);
  if (explicitOutcomes.length >= 2) return explicitOutcomes;

  const sources = observation.outcomeSources ?? [];
  if (sources.length < 2) return explicitOutcomes;

  const composedOutcomes = sources.map((source) => {
    const market = findExistingMarketByRef(source.fromMarketId, existingMarkets);
    if (!market || (!market.resolvedAt && market.status !== "resolved")) return "";
    return winnerLabelsForMarket(market)[0] ?? "";
  });

  return composedOutcomes.every(Boolean) ? unique(composedOutcomes) : [];
}

function resolveObservationTitle(observation: SeerOpportunityObservation, outcomes: string[]): string {
  const template = observation.titleTemplate?.trim();
  if (template) {
    return template
      .replaceAll("{outcome1}", outcomes[0] ?? "")
      .replaceAll("{outcome2}", outcomes[1] ?? "")
      .replaceAll("{1}", outcomes[0] ?? "")
      .replaceAll("{2}", outcomes[1] ?? "")
      .trim();
  }

  const title = observation.title?.trim();
  if (title) return title;
  return `${outcomes[0] ?? "צד א"} נגד ${outcomes[1] ?? "צד ב"}`;
}

function buildSuggestedHumanPrompt(input: {
  title: string;
  outcomes: string[];
  sourceUrl: string | null;
  reason: string;
}): string {
  return [
    `Draft next market: ${input.title}`,
    `Outcomes: ${input.outcomes.join(" / ")}`,
    input.sourceUrl ? `Source: ${input.sourceUrl}` : "",
    `Why now: ${input.reason}`
  ].filter(Boolean).join("\n");
}

function nextBracketStageLabel(stageLabel: string): string {
  const normalized = normalizeOpportunityText(stageLabel);
  if (normalized.includes("round of 16") || normalized.includes("last 16") || normalized.includes("שמינית")) {
    return stageLabel.includes("שמינית") ? "רבע הגמר" : "Quarter-final";
  }
  if (normalized.includes("quarter") || normalized.includes("רבע")) {
    return stageLabel.includes("רבע") ? "חצי הגמר" : "Semi-final";
  }
  if (normalized.includes("semi") || normalized.includes("חצי")) {
    return stageLabel.includes("חצי") ? "הגמר" : "Final";
  }
  return "השלב הבא";
}

function hebrewStagePhrase(stageLabel: string): string {
  const normalized = normalizeOpportunityText(stageLabel);
  if (normalized === "גמר" || normalized === "הגמר" || normalized === "final") return "בגמר";
  if (/^[\u0590-\u05ff]/.test(stageLabel)) return `ב${stageLabel}`;
  return `ב-${stageLabel}`;
}

function sourceLabelForFeeder(feeder: BracketMatchFeeder): string {
  return (
    readString(readPath(feeder.market.contract, ["resolutionSource", "label"])) ||
    (feeder.sourceIds.includes("src_fifa_match_centre") ? "פיפ״א, עמוד המשחק הרשמי" : "") ||
    (feeder.sourceIds.includes("src_wimbledon_official") ? "המקור הרשמי של הטורניר" : "") ||
    "מקור רשמי"
  );
}

function cloneRecord(value: unknown): JsonRecord | null {
  const object = readObject(value);
  return object ? JSON.parse(JSON.stringify(object)) as JsonRecord : null;
}

function buildResolvedBracketPairDraftSeed(input: {
  first: BracketMatchFeeder;
  second: BracketMatchFeeder;
  outcomes: string[];
  title: string;
  candidateMarketId: string;
  eventSlug: string;
  sourceIds: string[];
}): SeerOpportunityMarketDraftSeed {
  const nextStageLabel = nextBracketStageLabel(input.first.stageLabel);
  const stagePhrase = hebrewStagePhrase(nextStageLabel);
  const sourceLabel = sourceLabelForFeeder(input.first);
  const baseContract = input.first.market.contract ?? {};
  const description = `שוק על המנצחת הרשמית במשחק ${input.title} ${stagePhrase} ${input.first.competitionLabel}.`;
  const resolutionRule = [
    `השוק מודד את המנצחת הרשמית במשחק ${input.title} ${stagePhrase} ${input.first.competitionLabel}.`,
    `${input.outcomes[0]} זוכה אם ${sourceLabel} מפרסם שהיא העפילה לשלב הבא; ${input.outcomes[1]} זוכה אם ${sourceLabel} מפרסם שהיא העפילה לשלב הבא. הארכה ופנדלים נספרים כחלק מההכרעה הרשמית.`,
    "",
    "התוצאות בשוק הן בלעדיות: רק אחת מהן יכולה להיסגר כזוכה."
  ].join("\n");
  const marketContract: JsonRecord = {
    objectType: "market_contract_v1",
    version: readString(baseContract.version) || "seer-contract-v1",
    marketKindId: "sports.game-winner",
    measurement: `המנצחת הרשמית במשחק ${input.title} ${stagePhrase} ${input.first.competitionLabel}`,
    measurementKind: "final_winner",
    resultShape: "home_away_winner",
    displayHints: {
      notes: ["Render as named opponents, not yes/no copy."],
      stageLabel: nextStageLabel,
      matchupKind: "home_away_winner",
      affirmativeLabel: input.outcomes[0],
      negativeLabel: input.outcomes[1],
      competitionLabel: input.first.competitionLabel,
      binaryPresentation: "named_opponents"
    },
    resolutionSource: {
      label: sourceLabel,
      sourceIds: input.sourceIds
    },
    resolutionRule,
    timeline: {
      notes: [
        "המשחק עשוי להסתיים אחרי הארכה או פנדלים, ולכן ההכרעה צפויה רק אחרי פרסום התוצאה הרשמית.",
        "יש להשלים closeAt, expectedResolutionAt ו-kickoffLocal אחרי שפיפ״א מפרסמת את עמוד המשחק הרשמי."
      ],
      timezone: readString(readPath(baseContract, ["timeline", "timezone"])) || "Asia/Jerusalem"
    },
    delayPolicy: readString(baseContract.delayPolicy) || "אם המשחק נדחה, השוק נשאר בהמתנה עד שהמשחק יושלם ותפורסם תוצאה רשמית.",
    dataRevisionPolicy: readString(baseContract.dataRevisionPolicy) || "תיקונים רשמיים לפני הכרעה ייספרו. אחרי שהשוק נפתר ואושר במערכת, תיקונים מאוחרים לא ישנו את התוצאה אלא אם נדרשת בדיקת מפעיל חריגה.",
    ambiguityPolicy: readString(baseContract.ambiguityPolicy) || "הכרעה תתבסס רק על המנצחת הרשמית שמופיעה במקור הרשמי. אם מקור רשמי מציג נתונים סותרים או לא שלמים, השוק ימתין לבדיקה ולא יוכרע לפי דיווח לא רשמי.",
    reviewBlockers: [
      "needs_official_fixture_url",
      "needs_close_at",
      "needs_expected_resolution_at",
      "needs_home_away_confirmation"
    ],
    sourceRolePlan: {
      wake: [`Find the official fixture page for ${input.title} ${stagePhrase} ${input.first.competitionLabel}.`],
      notes: ["Binary official-winner market; no draw outcome because knockout official winner is the settlement target."],
      ground: ["Confirm official home/away ordering, kickoff time, stage, and exact source URL before publishing."],
      resolve: ["Use the exact official fixture/match endpoint only after it is known."],
      integrity: ["Do not resolve from generic match-centre or bracket pages."]
    },
    payoutPolicy: readString(baseContract.payoutPolicy) || "התשלום מתבצע רק אחרי שהתוצאה הרשמית מאומתת ומאושרת במערכת.",
    referenceQuarantine: cloneRecord(baseContract.referenceQuarantine),
    oracleCapability: readString(baseContract.oracleCapability) || "supported_full_cycle",
    image: cloneRecord(baseContract.image),
    outcomeMap: [
      {
        evidenceKey: "home",
        outcomeKind: "named-outcome",
        outcomeLabel: input.outcomes[0],
        resolutionPath: `${input.outcomes[0]} is the official match winner.`
      },
      {
        evidenceKey: "away",
        outcomeKind: "named-outcome",
        outcomeLabel: input.outcomes[1],
        resolutionPath: `${input.outcomes[1]} is the official match winner.`
      }
    ]
  };

  return {
    objectType: "seer_opportunity_market_draft_seed",
    status: "needs_official_fixture",
    title: input.title,
    description,
    candidateMarketId: input.candidateMarketId,
    eventSlug: input.eventSlug,
    categoryKey: "sports",
    outcomes: input.outcomes,
    seededFromMarketIds: [input.first.market.id, input.second.market.id],
    reviewBlockers: [
      "needs_official_fixture_url",
      "needs_close_at",
      "needs_expected_resolution_at",
      "needs_home_away_confirmation"
    ],
    marketContract
  };
}

function suggestionFromTournamentEvent(
  event: TournamentEventLike,
  existingMarkets: ExistingMarketLike[]
): SeerOpportunitySuggestion | null {
  const activeChildren = activeUnresolvedTournamentChildren(event);
  if (activeChildren.length !== 2) return null;

  const labels = activeChildren.map(childEntityLabel);
  const aliases = activeChildren.map(childAliases);
  const categoryKey = event.categoryKey ?? "sports";
  const eventSlugBase = event.slug?.replace(/-winner$/, "") || slugPart(event.title, "tournament-final");
  const pairSlug = labels.map((label, index) => slugPart(aliases[index]?.find((alias) => /[a-z]/i.test(alias)) ?? label, `side-${index + 1}`)).join("-");
  const idBase = `${eventSlugBase}-${pairSlug}`;
  const candidateMarketId = `${idBase}-winner-${shortHash(pairKey(labels))}`;
  const eventSlug = `${idBase}-${shortHash(pairKey(labels)).slice(0, 5)}`;
  const sourceUrl =
    readString(readPath(activeChildren[0]?.contract, ["resolutionSource", "url"])) ||
    readString(readPath(activeChildren[0]?.contract, ["trustDisplayUrl"])) ||
    null;
  const sourceIds = unique(activeChildren.flatMap((child) => readStringArray(readPath(child.contract, ["resolutionSource", "sourceIds"]))));
  const title = `${labels[0]} נגד ${labels[1]}`;
  const reason = `Only two unresolved tournament-winner children remain in ${event.title}; suggest the missing final match market.`;
  const duplicateOf = findOpportunityDuplicates({ candidateMarketId, eventSlug, outcomes: labels, sourceUrl }, existingMarkets);

  return {
    objectType: "seer_opportunity_suggestion",
    id: `opp_${shortHash(`${event.id}:${pairKey(labels)}`)}`,
    source: "tournament_two_left",
    opportunityType: "match_winner",
    status: duplicateOf.length > 0 ? "duplicate" : "suggested",
    title,
    candidateMarketId,
    eventSlug,
    categoryKey,
    closeAt: null,
    expectedResolutionAt: null,
    outcomes: labels,
    sourceUrl,
    sourceIds,
    confidence: "medium",
    reason,
    duplicateOf,
    suggestedHumanPrompt: buildSuggestedHumanPrompt({ title, outcomes: labels, sourceUrl, reason })
  };
}

function suggestionFromResolvedBracketPair(
  first: BracketMatchFeeder,
  second: BracketMatchFeeder,
  pairIndex: number,
  existingMarkets: ExistingMarketLike[]
): SeerOpportunitySuggestion | null {
  if (!isResolvedMarket(first.market) || !isResolvedMarket(second.market)) return null;

  const orderedPair = [first, second].sort((left, right) => right.closeAtMs - left.closeAtMs);
  const outcomes = orderedPair.map((item) => winnerLabelsForMarket(item.market)[0] ?? "");
  if (!outcomes.every(Boolean) || unique(outcomes).length < 2) return null;

  const sourceIds = unique([...first.sourceIds, ...second.sourceIds]);
  const sourceFamily = first.sourceFamily;
  const title = `${outcomes[0]} נגד ${outcomes[1]}`;
  const groupSlug = [
    sourceFamily,
    slugPart(first.competitionLabel, "competition"),
    slugPart(first.stageLabel, "stage"),
    `pair-${pairIndex + 1}`
  ].join("-");
  const hash = shortHash(`${first.market.id}:${second.market.id}:${pairKey(outcomes)}`);
  const candidateMarketId = `${groupSlug}-winner-${hash}`;
  const eventSlug = `${groupSlug}-${hash.slice(0, 5)}`;
  const reason = [
    `Resolved adjacent ${first.stageLabel} feeder matches in ${first.competitionLabel};`,
    `suggest the next match between ${outcomes.join(" and ")}.`
  ].join(" ");
  const suggestedMarketDraft = buildResolvedBracketPairDraftSeed({
    first,
    second,
    outcomes,
    title,
    candidateMarketId,
    eventSlug,
    sourceIds
  });
  const duplicateOf = findOpportunityDuplicates({
    candidateMarketId,
    eventSlug,
    outcomes,
    sourceUrl: null
  }, existingMarkets);

  return {
    objectType: "seer_opportunity_suggestion",
    id: `opp_${shortHash(`${first.market.id}:${second.market.id}`)}`,
    source: "resolved_match_pair",
    opportunityType: "match_winner",
    status: duplicateOf.length > 0 ? "duplicate" : "suggested",
    title,
    candidateMarketId,
    eventSlug,
    categoryKey: "sports",
    closeAt: null,
    expectedResolutionAt: null,
    outcomes,
    sourceUrl: null,
    sourceIds,
    confidence: "medium",
    reason,
    duplicateOf,
    suggestedHumanPrompt: buildSuggestedHumanPrompt({ title, outcomes, sourceUrl: null, reason }),
    suggestedMarketDraft
  };
}

function suggestionsFromResolvedBracketPairs(existingMarkets: ExistingMarketLike[]): SeerOpportunitySuggestion[] {
  const groups = new Map<string, BracketMatchFeeder[]>();

  for (const market of existingMarkets) {
    const feeder = bracketMatchFeeder(market);
    if (!feeder) continue;
    groups.set(feeder.groupKey, [...(groups.get(feeder.groupKey) ?? []), feeder]);
  }

  const suggestions: SeerOpportunitySuggestion[] = [];
  for (const feeders of groups.values()) {
    const sortedFeeders = [...feeders].sort((left, right) =>
      left.closeAtMs - right.closeAtMs || left.market.id.localeCompare(right.market.id)
    );
    for (let index = 0; index + 1 < sortedFeeders.length; index += 2) {
      const suggestion = suggestionFromResolvedBracketPair(
        sortedFeeders[index],
        sortedFeeders[index + 1],
        index / 2,
        existingMarkets
      );
      if (suggestion) suggestions.push(suggestion);
    }
  }

  return suggestions;
}

function suggestionFromObservation(
  observation: SeerOpportunityObservation,
  existingMarkets: ExistingMarketLike[]
): SeerOpportunitySuggestion | null {
  const outcomes = resolveObservationOutcomes(observation, existingMarkets);
  if (outcomes.length < 2) return null;
  const title = resolveObservationTitle(observation, outcomes);
  const candidateMarketId =
    observation.candidateMarketId?.trim() ||
    `${slugPart(title, "market")}-${shortHash(`${observation.sourceUrl}:${pairKey(outcomes)}`)}`;
  const eventSlug =
    observation.eventSlug?.trim() ||
    `${slugPart(title, "event")}-${shortHash(`${observation.sourceUrl}:${pairKey(outcomes)}`).slice(0, 5)}`;
  const isComposed = (observation.outcomeSources?.length ?? 0) > 0;
  const reason = observation.reason?.trim() ||
    (isComposed
      ? `Resolved feeder markets are known; suggest the composed next market from ${observation.sourceFamily}.`
      : "Source observation indicates a new market opportunity.");
  const duplicateOf = findOpportunityDuplicates({
    candidateMarketId,
    eventSlug,
    outcomes,
    sourceUrl: observation.sourceUrl
  }, existingMarkets);

  return {
    objectType: "seer_opportunity_suggestion",
    id: `opp_${shortHash(`${candidateMarketId}:${observation.sourceUrl}`)}`,
    source: isComposed ? "composed_source_observation" : "source_observation",
    opportunityType: "match_winner",
    status: duplicateOf.length > 0 ? "duplicate" : "suggested",
    title,
    candidateMarketId,
    eventSlug,
    categoryKey: observation.categoryKey ?? "sports",
    closeAt: observation.closeAt ?? null,
    expectedResolutionAt: observation.expectedResolutionAt ?? null,
    outcomes,
    sourceUrl: observation.sourceUrl,
    sourceIds: observation.sourceIds ?? [],
    confidence: observation.confidence ?? "medium",
    reason,
    duplicateOf,
    suggestedHumanPrompt: buildSuggestedHumanPrompt({
      title,
      outcomes,
      sourceUrl: observation.sourceUrl,
      reason
    })
  };
}

export function scanSeerOpportunities(input: {
  events?: TournamentEventLike[];
  observations?: SeerOpportunityObservation[];
  existingMarkets?: ExistingMarketLike[];
  now?: string;
  includeDuplicates?: boolean;
}): SeerOpportunityScanReceipt {
  const existingMarkets = input.existingMarkets ?? [];
  const eventSuggestions = (input.events ?? [])
    .map((event) => suggestionFromTournamentEvent(event, existingMarkets))
    .filter((suggestion): suggestion is SeerOpportunitySuggestion => Boolean(suggestion));
  const observationSuggestions = (input.observations ?? []).map((observation) =>
    suggestionFromObservation(observation, existingMarkets)
  ).filter((suggestion): suggestion is SeerOpportunitySuggestion => Boolean(suggestion));
  const bracketPairSuggestions = suggestionsFromResolvedBracketPairs(existingMarkets);
  const allSuggestions = [...eventSuggestions, ...bracketPairSuggestions, ...observationSuggestions];
  const suggestions = input.includeDuplicates
    ? allSuggestions
    : allSuggestions.filter((suggestion) => suggestion.status === "suggested");

  return {
    objectType: "seer_opportunity_watch_receipt",
    generatedAt: input.now ?? new Date().toISOString(),
    eventCount: input.events?.length ?? 0,
    observationCount: input.observations?.length ?? 0,
    existingMarketCount: existingMarkets.length,
    suggestionCount: suggestions.filter((suggestion) => suggestion.status === "suggested").length,
    duplicateCount: allSuggestions.filter((suggestion) => suggestion.status === "duplicate").length,
    suggestions
  };
}
