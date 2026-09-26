import type {
  CanonicalIntakeLane,
  OperatorLead,
  OperatorLeadRole,
  OperatorLeadSourceType,
  OperatorLeadStatus
} from "./contracts";
import { normalizeIntakeLane } from "./intake-lanes";
import { slugify } from "./text";

const allowedLeadSourceTypes: OperatorLeadSourceType[] = [
  "external_market",
  "news",
  "official_source",
  "friend_tip",
  "manual_note"
];

const allowedLeadRoles: OperatorLeadRole[] = ["shape_reference", "attention_reference", "source_candidate"];
const allowedLeadStatuses: OperatorLeadStatus[] = ["new", "grounding", "converted", "parked", "rejected"];

export type OperatorLeadDraft = {
  createdBy?: string;
  leadUrl?: string;
  leadSourceType?: string;
  leadRole?: string;
  rawPrompt?: string;
  initialDomain?: string;
  expectedLane?: string;
  status?: string;
  convertedEventId?: string;
  externalQuestion?: string;
  externalOutcomes?: string[];
  externalCloseTime?: string;
  externalRules?: string;
  externalSourceRefs?: string[];
  trainingUse?: string;
  receiptRef?: string;
  notes?: string[];
};

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, fieldName: string): T {
  const normalized = value?.trim() || fallback;

  if (!allowed.includes(normalized as T)) {
    throw new Error(`Invalid ${fieldName}. Expected one of: ${allowed.join(", ")}`);
  }

  return normalized as T;
}

function cleanList(values: string[] | undefined): string[] | undefined {
  const cleaned = values?.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function normalizeExpectedLane(value: string | undefined): CanonicalIntakeLane {
  return normalizeIntakeLane(value);
}

export function buildOperatorLead(draft: OperatorLeadDraft, generatedAt: string): OperatorLead {
  const rawPrompt = draft.rawPrompt?.trim();

  if (!rawPrompt) {
    throw new Error("Operator lead is missing rawPrompt");
  }

  const createdBy = draft.createdBy?.trim() || "operator";
  const leadUrl = draft.leadUrl?.trim();
  const leadSourceType = parseEnum(draft.leadSourceType, allowedLeadSourceTypes, "manual_note", "leadSourceType");
  const leadRole = parseEnum(draft.leadRole, allowedLeadRoles, "attention_reference", "leadRole");
  const status = parseEnum(draft.status, allowedLeadStatuses, "new", "status");
  const initialDomain = draft.initialDomain?.trim() || "unknown";
  const expectedLane = normalizeExpectedLane(draft.expectedLane);
  const leadId = `olead_${slugify(`${generatedAt}_${createdBy}_${leadUrl ?? rawPrompt.slice(0, 80)}`)}`;

  return {
    objectType: "operator_lead",
    leadId,
    createdAt: generatedAt,
    createdBy,
    leadUrl,
    leadSourceType,
    leadRole,
    rawPrompt,
    initialDomain,
    expectedLane,
    status,
    convertedEventId: draft.convertedEventId?.trim(),
    externalQuestion: draft.externalQuestion?.trim(),
    externalOutcomes: cleanList(draft.externalOutcomes),
    externalCloseTime: draft.externalCloseTime?.trim(),
    externalRules: draft.externalRules?.trim(),
    externalSourceRefs: cleanList(draft.externalSourceRefs),
    trainingUse: draft.trainingUse?.trim(),
    receiptRef: draft.receiptRef?.trim(),
    notes: cleanList(draft.notes)
  };
}
