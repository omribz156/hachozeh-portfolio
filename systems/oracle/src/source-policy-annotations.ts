import type {
  OracleSourcePolicy,
  OracleSourcePolicyHints,
  OracleSourceRolePlan
} from "./contracts";

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))];
}

export function normalizeOracleSourcePolicy(value: unknown): OracleSourcePolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  function readStringArray(fieldName: keyof OracleSourcePolicy): string[] | undefined {
    const raw = candidate[fieldName];

    if (!Array.isArray(raw)) {
      return undefined;
    }

    const items = dedupe(raw.filter((entry): entry is string => typeof entry === "string"));

    return items.length > 0 ? items : undefined;
  }

  const policy: OracleSourcePolicy = {
    preferredSourceIds: readStringArray("preferredSourceIds"),
    fallbackSourceIds: readStringArray("fallbackSourceIds"),
    contextSourceIds: readStringArray("contextSourceIds"),
    closeConditionSourceIds: readStringArray("closeConditionSourceIds"),
    resolutionSourceIds: readStringArray("resolutionSourceIds"),
    notes: readStringArray("notes")
  };
  const credibleReporting =
    candidate.credibleReporting &&
    typeof candidate.credibleReporting === "object" &&
    !Array.isArray(candidate.credibleReporting)
      ? (candidate.credibleReporting as Record<string, unknown>)
      : null;

  if (credibleReporting) {
    const approvedSourceIds = Array.isArray(credibleReporting.approvedSourceIds)
      ? dedupe(
          credibleReporting.approvedSourceIds.filter(
            (entry): entry is string => typeof entry === "string"
          )
        )
      : undefined;

    policy.credibleReporting = {
      minimumIndependentSources:
        typeof credibleReporting.minimumIndependentSources === "number" &&
        Number.isFinite(credibleReporting.minimumIndependentSources)
          ? Math.max(1, Math.floor(credibleReporting.minimumIndependentSources))
          : undefined,
      approvedSourceIds: approvedSourceIds && approvedSourceIds.length > 0 ? approvedSourceIds : undefined,
      conflictPolicy:
        typeof credibleReporting.conflictPolicy === "string" &&
        credibleReporting.conflictPolicy.trim()
          ? credibleReporting.conflictPolicy.trim()
          : undefined,
      correctionWindow:
        typeof credibleReporting.correctionWindow === "string" &&
        credibleReporting.correctionWindow.trim()
          ? credibleReporting.correctionWindow.trim()
          : undefined,
      requiresHumanReview:
        typeof credibleReporting.requiresHumanReview === "boolean"
          ? credibleReporting.requiresHumanReview
          : undefined
    };
  }

  if (typeof candidate.requiresHumanReviewOnSourceConflict === "boolean") {
    policy.requiresHumanReviewOnSourceConflict =
      candidate.requiresHumanReviewOnSourceConflict;
  }

  if (typeof candidate.requiresHumanReviewOnWeakAuthority === "boolean") {
    policy.requiresHumanReviewOnWeakAuthority =
      candidate.requiresHumanReviewOnWeakAuthority;
  }

  if (
    !policy.preferredSourceIds &&
    !policy.fallbackSourceIds &&
    !policy.contextSourceIds &&
    !policy.closeConditionSourceIds &&
    !policy.resolutionSourceIds &&
    !policy.credibleReporting &&
    !policy.notes &&
    policy.requiresHumanReviewOnSourceConflict == null &&
    policy.requiresHumanReviewOnWeakAuthority == null
  ) {
    return null;
  }

  return policy;
}

export function parseOracleSourcePolicyHints(
  policy: OracleSourcePolicy | null | undefined
): OracleSourcePolicyHints {
  const sourceRolePlan: OracleSourceRolePlan = {
    wake: [],
    ground: [],
    resolve: [],
    integrity: []
  };
  const fetchNeeds: string[] = [];
  const policyNotes: string[] = [];

  for (const rawNote of policy?.notes ?? []) {
    const note = rawNote.trim();

    if (!note) {
      continue;
    }

    if (note.startsWith("wake-role=")) {
      sourceRolePlan.wake.push(note.slice("wake-role=".length));
      continue;
    }

    if (note.startsWith("ground-role=")) {
      sourceRolePlan.ground.push(note.slice("ground-role=".length));
      continue;
    }

    if (note.startsWith("resolve-role=")) {
      sourceRolePlan.resolve.push(note.slice("resolve-role=".length));
      continue;
    }

    if (note.startsWith("integrity-role=")) {
      sourceRolePlan.integrity.push(note.slice("integrity-role=".length));
      continue;
    }

    if (note.startsWith("fetch-needed=")) {
      fetchNeeds.push(note.slice("fetch-needed=".length));
      continue;
    }

    policyNotes.push(note);
  }

  return {
    sourceRolePlan: {
      wake: dedupe(sourceRolePlan.wake),
      ground: dedupe(sourceRolePlan.ground),
      resolve: dedupe(sourceRolePlan.resolve),
      integrity: dedupe(sourceRolePlan.integrity)
    },
    fetchNeeds: dedupe(fetchNeeds),
    policyNotes: dedupe(policyNotes)
  };
}
