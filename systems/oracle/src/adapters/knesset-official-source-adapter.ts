import {
  defaultFetchedAt,
  fetchOracleAdapterJson,
  hashRawSnapshot,
  readContractResolutionSourceUrl,
  readContractSourceIds,
  readSourceHaystack,
  type OracleLifecycleSourceAdapter,
  type OracleLifecycleSourceContext,
  type OracleSourceAdapterFetchers,
  type OracleSourceInspection
} from "../source-adapter-contracts";

const KNESSET_OFFICIAL_SOURCE_ID = "src_knesset_official";
const KNESSET_OFFICIAL_SOURCE_FAMILY = "knesset_official_legislation";
const KNESSET_OFFICIAL_SOURCE_LABEL = "Knesset official legislation status";
const KNESSET_OFFICIAL_FETCH_HEADERS = {
  "user-agent": "Hachozeh Oracle Knesset official legislation adapter"
};
const KNESSET_OFFICIAL_ALLOWED_HOSTS = ["knesset.gov.il", "www.knesset.gov.il"];
const KNESSET_BILL_URL_PATTERN =
  /^https:\/\/(?:www\.)?main\.knesset\.gov\.il\/apps\/legislation\/main\/bills\/[0-9]+(?:[/?#].*)?$/i;
const KNESSET_ODATA_BILL_ENDPOINT = "https://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill";

const FINAL_YES_STATUS_IDS = new Set([118]);
const FINAL_NO_STATUS_IDS = new Set([110, 140, 143, 176, 177]);
const MANUAL_STATUS_IDS = new Set([122]);
const KNESSET_STATUS_LABELS: Record<number, string> = {
  104: "הונחה על שולחן הכנסת לדיון מוקדם",
  108: "הכנה לקריאה ראשונה",
  109: "אושרה בוועדה לקריאה ראשונה",
  110: "הבקשה לדין רציפות נדחתה במליאה",
  111: "לדיון במליאה לקראת הקריאה הראשונה",
  113: "הכנה לקריאה שנייה ושלישית",
  114: "לדיון במליאה לקראת קריאה שנייה-שלישית",
  115: "הוחזרה לוועדה להכנה לקריאה שלישית",
  117: "לדיון במליאה לקראת קריאה שלישית",
  118: "התקבלה בקריאה שלישית",
  122: "מוזגה עם הצעת חוק אחרת",
  130: "הונחה על שולחן הכנסת לקריאה שנייה-שלישית",
  131: "הונחה על שולחן הכנסת לקריאה שלישית",
  140: "להסרה מסדר היום לבקשת ועדה",
  143: "להסרה מסדר היום לבקשת ועדה",
  176: "הבקשה לדין רציפות נדחתה בוועדה",
  177: "נעצרה",
  178: "אושרה בוועדה לקריאה שנייה-שלישית",
  179: "אושרה בוועדה לקריאה שנייה-שלישית"
};

type KnessetBillStatus =
  | { state: "final"; evidenceKey: "yes" | "no"; reason: string; statusId: number | null }
  | { state: "in_progress"; reason: string; statusId: number | null }
  | { state: "manual"; reason: string; statusId: number | null }
  | { state: "unrecognized"; reason: string; statusId?: number | null };

type KnessetBillRecord = {
  BillID?: unknown;
  KnessetNum?: unknown;
  Name?: unknown;
  StatusID?: unknown;
  LastUpdatedDate?: unknown;
};

function readKnessetSourceUrl(context: OracleLifecycleSourceContext): string | null {
  const contractUrl = readContractResolutionSourceUrl(context);
  if (contractUrl) {
    return contractUrl;
  }

  const haystack = readSourceHaystack(context);
  const match = haystack.match(/https:\/\/(?:www\.)?main\.knesset\.gov\.il\/\S+/i);
  return match?.[0]?.replace(/[),.;]+$/g, "") ?? null;
}

function readBillId(sourceUrl: string | null): string | null {
  const match = sourceUrl?.match(/\/bills\/(\d+)/i);
  return match?.[1] ?? null;
}

function knessetBillODataUrl(billId: string): string {
  return `${KNESSET_ODATA_BILL_ENDPOINT}?$filter=BillID%20eq%20${billId}&$format=json`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readODataBillRecord(value: unknown): KnessetBillRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as { value?: unknown };
  if (!Array.isArray(record.value) || record.value.length === 0) {
    return null;
  }

  const first = record.value[0];
  return first && typeof first === "object" && !Array.isArray(first) ? (first as KnessetBillRecord) : null;
}

function parseKnessetBillStatus(record: KnessetBillRecord | null): KnessetBillStatus {
  if (!record) {
    return { state: "unrecognized", reason: "knesset_bill_not_found", statusId: null };
  }

  const statusId = readNumber(record.StatusID);
  const statusText =
    readString((record as Record<string, unknown>).StatusDesc) ??
    (statusId != null ? KNESSET_STATUS_LABELS[statusId] : undefined) ??
    "";

  if (statusId != null && FINAL_YES_STATUS_IDS.has(statusId)) {
    return {
      state: "final",
      evidenceKey: "yes",
      reason: statusText || "התקבלה בקריאה שלישית",
      statusId
    };
  }

  if (statusId != null && FINAL_NO_STATUS_IDS.has(statusId)) {
    return {
      state: "final",
      evidenceKey: "no",
      reason: statusText || "סטטוס סופי שאינו אישור החוק",
      statusId
    };
  }

  if (statusId != null && MANUAL_STATUS_IDS.has(statusId)) {
    return {
      state: "manual",
      reason: statusText || "מוזגה עם הצעת חוק אחרת",
      statusId
    };
  }

  if (statusId != null) {
    return {
      state: "in_progress",
      reason: statusText || `knesset_status_${statusId}`,
      statusId
    };
  }

  return { state: "unrecognized", reason: "missing_knesset_status_id", statusId };
}

function labelForEvidenceKey(context: OracleLifecycleSourceContext, evidenceKey: "yes" | "no"): string {
  return (
    context.marketContract?.outcomeMap?.find((outcome) => outcome.evidenceKey === evidenceKey)?.outcomeLabel ??
    (evidenceKey === "yes" ? "כן" : "לא")
  );
}

async function inspectKnessetOfficialResolution(
  context: OracleLifecycleSourceContext,
  fetchers: OracleSourceAdapterFetchers
): Promise<OracleSourceInspection> {
  const fetchedAt = defaultFetchedAt(fetchers);
  const sourceUrl = readKnessetSourceUrl(context);

  if (!sourceUrl) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl: "",
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(""),
      normalizedSnapshot: {
        sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
        sourceUrl: null,
        evidenceKey: null,
        reason: "missing_knesset_resolution_source_url"
      },
      claimSummary: "No official Knesset bill source URL found.",
      confidence: "low",
      blockers: ["missing_knesset_official_source_url"]
    };
  }

  const billId = readBillId(sourceUrl);
  if (!billId) {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      fetchedAt,
      rawHash: hashRawSnapshot(sourceUrl),
      normalizedSnapshot: {
        sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
        sourceUrl,
        billId: null,
        evidenceKey: null,
        reason: "missing_knesset_bill_id"
      },
      claimSummary: "Official Knesset bill URL did not include a bill id.",
      confidence: "low",
      blockers: ["missing_knesset_bill_id"]
    };
  }

  const officialJsonUrl = knessetBillODataUrl(billId);
  const rawJson = await (
    fetchers.fetchJson ??
    ((url) =>
      fetchOracleAdapterJson(url, {
        headers: KNESSET_OFFICIAL_FETCH_HEADERS,
        allowedHosts: KNESSET_OFFICIAL_ALLOWED_HOSTS
      }))
  )(officialJsonUrl);
  const billRecord = readODataBillRecord(rawJson);
  const parsed = parseKnessetBillStatus(billRecord);
  const billName = readString(billRecord?.Name);
  const statusId = readNumber(billRecord?.StatusID);
  const lastUpdatedDate = readString(billRecord?.LastUpdatedDate);

  if (parsed.state === "unrecognized") {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      officialJsonUrl,
      fetchedAt,
      rawHash: hashRawSnapshot(rawJson),
      normalizedSnapshot: {
        sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
        sourceUrl,
        billId,
        billName,
        officialJsonUrl,
        statusId,
        lastUpdatedDate,
        evidenceKey: null,
        status: parsed.state,
        reason: parsed.reason
      },
      claimSummary:
        "Knesset official OData did not expose a usable bill status; manual review needed.",
      confidence: "low",
      blockers: ["knesset_bill_status_unrecognized"]
    };
  }

  if (parsed.state === "manual") {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl,
      status: "unknown",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      officialJsonUrl,
      fetchedAt,
      rawHash: hashRawSnapshot(rawJson),
      normalizedSnapshot: {
        sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
        sourceUrl,
        billId,
        billName,
        officialJsonUrl,
        statusId,
        lastUpdatedDate,
        evidenceKey: null,
        status: parsed.state,
        reason: parsed.reason
      },
      claimSummary: `Knesset bill status is ${parsed.reason}; operator review needed before resolving.`,
      confidence: "medium",
      blockers: ["knesset_bill_status_requires_manual_review"]
    };
  }

  if (parsed.state === "in_progress") {
    return {
      objectType: "oracle_source_inspection",
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl,
      status: "live",
      closeConditionSatisfied: false,
      resolutionAvailable: false,
      officialJsonUrl,
      fetchedAt,
      rawHash: hashRawSnapshot(rawJson),
      normalizedSnapshot: {
        sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
        sourceUrl,
        billId,
        billName,
        officialJsonUrl,
        statusId,
        lastUpdatedDate,
        evidenceKey: null,
        status: parsed.state,
        reason: parsed.reason
      },
      claimSummary: `Knesset official status is in progress (${parsed.reason}); final passage not confirmed yet.`,
      confidence: "medium",
      blockers: []
    };
  }

  const winnerLabel = labelForEvidenceKey(context, parsed.evidenceKey);
  return {
    objectType: "oracle_source_inspection",
    sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
    sourceUrl,
    status: "final",
    closeConditionSatisfied: true,
    resolutionAvailable: true,
    evidenceKey: parsed.evidenceKey,
    winnerKind: "named",
    winnerLabel,
    officialJsonUrl,
    fetchedAt,
    rawHash: hashRawSnapshot(rawJson),
    normalizedSnapshot: {
      sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
      sourceUrl,
      billId,
      billName,
      officialJsonUrl,
      statusId,
      lastUpdatedDate,
      evidenceKey: parsed.evidenceKey,
      status: parsed.state,
      reason: parsed.reason
    },
    claimSummary: `Knesset official status maps to ${parsed.evidenceKey} (${parsed.reason}).`,
    confidence: "high",
    blockers: []
  };
}

export const KNESSET_OFFICIAL_SOURCE_ADAPTER: OracleLifecycleSourceAdapter = {
  sourceFamily: KNESSET_OFFICIAL_SOURCE_FAMILY,
  sourceLabel: KNESSET_OFFICIAL_SOURCE_LABEL,
  sourceIds: [KNESSET_OFFICIAL_SOURCE_ID],
  measurementKinds: ["deadline_yes_no"],
  resultShapes: ["yes_no"],
  routes: [{ measurementKind: "deadline_yes_no", resultShape: "yes_no" }],
  capabilities: {
    closeCondition: true,
    resolution: true
  },
  supportsSource: (context) => {
    const sourceUrl = readKnessetSourceUrl(context);
    return readContractSourceIds(context).includes(KNESSET_OFFICIAL_SOURCE_ID) || KNESSET_BILL_URL_PATTERN.test(sourceUrl ?? "");
  },
  inspectCloseCondition: inspectKnessetOfficialResolution,
  inspectResolution: inspectKnessetOfficialResolution
};
