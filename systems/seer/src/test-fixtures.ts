import type {
  SeerSignal
} from "./pipeline";
import type {
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSnapshot,
  SourceRegistryEntry
} from "./contracts";

export const seerTestSources: SourceRegistryEntry[] = [
  {
    objectType: "source_registry_entry",
    sourceId: "src_boi_announcements",
    label: "Bank of Israel announcements",
    ownerLabel: "Bank of Israel",
    homepage: "https://www.boi.org.il/",
    primaryClass: "authority",
    accessSurface: "html",
    status: "trusted",
    curationMode: "manual-seed",
    stageUsefulness: ["grounding", "review"],
    categoryFit: ["economy"],
    createdAt: "2026-04-05T09:00:00Z",
    updatedAt: "2026-04-05T09:00:00Z"
  },
  {
    objectType: "source_registry_entry",
    sourceId: "src_google_trends_israel_interest_rate",
    label: "Google Trends: Israel interest rate",
    ownerLabel: "Google Trends",
    homepage: "https://trends.google.com/",
    primaryClass: "attention",
    accessSurface: "api",
    status: "seeded",
    curationMode: "manual-seed",
    stageUsefulness: ["sensing", "grounding"],
    categoryFit: ["economy"],
    createdAt: "2026-04-05T09:00:00Z",
    updatedAt: "2026-04-05T09:00:00Z"
  }
];

export const duplicatePressureSignals: SeerSignal[] = [
  {
    signalId: "sig_boi_march_primary",
    signalOrigin: "manual",
    sourceId: "src_boi_announcements",
    intakeLane: "planned",
    clusterKey: "boi-mar-primary",
    lineageLabel: "boi-rate-decisions",
    title: "Bank of Israel March 2026 rate decision",
    summary: "Official March rate decision timing is published.",
    category: "economy",
    sourceCategory: "economy",
    inferredCategory: "economy",
    whyNow: "March decision is approaching.",
    observedAt: "2026-03-28T10:22:00Z",
    sourceClass: "authority",
    sourceRef: "https://www.boi.org.il/",
    sourceLabel: "Bank of Israel",
    keyEntities: ["Bank of Israel", "interest rate"],
    sourceSummary: "Official source confirms timing and settlement anchor.",
    topicKind: "market-shaped",
    marketability: "already-shaped",
    inferenceNotes: ["Signal already carries explicit market shape."],
    question: "What will the Bank of Israel do at its March 30, 2026 rate decision?",
    marketAngle: "Discrete direction of the official March decision.",
    marketForm: "multi-outcome",
    proposedOutcomes: [
      { label: "Rate cut", kind: "named-outcome" },
      { label: "No change", kind: "named-outcome" },
      { label: "Rate hike", kind: "named-outcome" }
    ],
    marketWorthiness: "Clear scheduled event with known settlement anchor.",
    resolutionFeasibility: "Official announcement should settle the outcome cleanly.",
    suggestedCloseShape: "Close before May 30, 2026.",
    suggestedResolutionAnchor: "Bank of Israel official announcement: https://www.boi.org.il/"
  },
  {
    signalId: "sig_boi_march_duplicate",
    signalOrigin: "manual",
    sourceId: "src_google_trends_israel_interest_rate",
    intakeLane: "planned",
    clusterKey: "boi-mar-duplicate",
    lineageLabel: "boi-rate-decisions",
    title: "Bank of Israel March 2026 rate decision duplicate wording",
    summary: "Public attention is rising around the same March decision.",
    category: "economy",
    sourceCategory: "economy",
    inferredCategory: "economy",
    whyNow: "Same March decision is being discussed heavily.",
    observedAt: "2026-03-28T10:24:00Z",
    sourceClass: "attention",
    sourceRef: "google-trends:israel-interest-rate",
    sourceLabel: "Google Trends",
    keyEntities: ["Bank of Israel", "interest rate"],
    sourceSummary: "Public attention is focused on the same March decision.",
    topicKind: "market-shaped",
    marketability: "already-shaped",
    inferenceNotes: ["Signal already carries explicit market shape."],
    question: "How will the Bank of Israel decide on March 30, 2026 interest rates?",
    marketAngle: "Same decision reframed with duplicate wording.",
    marketForm: "multi-outcome",
    proposedOutcomes: [
      { label: "Rate cut", kind: "named-outcome" },
      { label: "No change", kind: "named-outcome" },
      { label: "Rate hike", kind: "named-outcome" }
    ],
    marketWorthiness: "This is really the same decision window.",
    resolutionFeasibility: "Official announcement should settle the outcome cleanly.",
    suggestedCloseShape: "Close before May 30, 2026.",
    suggestedResolutionAnchor: "Bank of Israel official announcement: https://www.boi.org.il/"
  },
  {
    signalId: "sig_boi_april_followup",
    signalOrigin: "manual",
    sourceId: "src_boi_announcements",
    intakeLane: "planned",
    clusterKey: "boi-apr-followup",
    lineageLabel: "boi-rate-decisions",
    title: "Bank of Israel April 2026 follow-up meeting",
    summary: "Attention is shifting toward the next scheduled meeting after March.",
    category: "economy",
    sourceCategory: "economy",
    inferredCategory: "economy",
    whyNow: "April follow-up meeting creates a new branch in the same lineage.",
    observedAt: "2026-03-29T09:00:00Z",
    sourceClass: "authority",
    sourceRef: "https://www.boi.org.il/april",
    sourceLabel: "Bank of Israel",
    keyEntities: ["Bank of Israel", "interest rate"],
    sourceSummary: "The same lineage now has a distinct next meeting window.",
    topicKind: "market-shaped",
    marketability: "already-shaped",
    inferenceNotes: ["Signal already carries explicit market shape."],
    question: "Will the committee reverse course at the April 2026 meeting?",
    marketAngle: "Follow-up branch around the next meeting rather than a duplicate March wording.",
    marketForm: "binary",
    proposedOutcomes: [
      { label: "כן", kind: "binary-side" },
      { label: "לא", kind: "binary-side" }
    ],
    marketWorthiness: "Distinct follow-up branch in an active BOI lineage.",
    resolutionFeasibility: "Later official announcement should settle the branch.",
    suggestedCloseShape: "Close before May 28, 2026.",
    suggestedResolutionAnchor: "Bank of Israel April announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"
  }
];

export const reviewMemoryQueueItem: ReviewHandoffItem = {
  objectType: "review_handoff_item",
  reviewItemId: "rh_boi_apr_followup",
  candidateMarketId: "cm_boi_apr_followup",
  category: "economy",
  headline: "Review: BOI April follow-up",
  question: "האם בנק ישראל יוריד שוב את הריבית בהחלטת אפריל 2026?",
  marketForm: "binary",
  proposedOutcomes: [
    { label: "כן", kind: "binary-side" },
    { label: "לא", kind: "binary-side" }
  ],
  whyNow: "April meeting is becoming the next branch.",
  decisionSummary: "Distinct follow-up branch.",
  maturity: "grounded",
  confidence: "medium",
  authorityReadiness: "high",
  lineageContext: "follow-up-branch",
  topSupport: "Official BOI timing plus demand for follow-up branch.",
  topRisks: [],
  sourceRolePlan: {
    wake: ["Google Trends: Israel interest rate"],
    ground: ["Bank of Israel"],
    resolve: ["Bank of Israel April announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/"]
  },
  recommendedAction: "approve-with-edits",
  recommendedActionWhy: "Strong follow-up branch.",
  suggestedCloseShape: "Close before April 28, 2026.",
  suggestedResolutionAnchor: "Bank of Israel April announcement: https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
  sensitivityLevel: "normal",
  topSourceRefs: ["https://www.boi.org.il/", "google-trends:israel-interest-rate"],
  topSourceIds: ["src_boi_announcements", "src_google_trends_israel_interest_rate"],
  createdAt: "2026-03-29T09:30:00Z",
  lineageId: "lin_boi_rate_decisions"
};

export const reviewMemoryQueueHistory: ReviewQueueSnapshot[] = [
  {
    objectType: "review_queue_snapshot",
    snapshotId: "rqs_fixture_1",
    generatedAt: "2026-03-29T09:31:00Z",
    itemCount: 1,
    items: [reviewMemoryQueueItem]
  }
];

export const reviewMemoryFeedbackLog: ReviewFeedbackItem[] = [
  {
    objectType: "review_feedback_item",
    reviewFeedbackId: "rf_fixture_approve",
    reviewItemId: "rh_boi_apr_followup",
    candidateMarketId: "cm_boi_apr_followup",
    lineageId: "lin_boi_rate_decisions",
    action: "approve-with-edits",
    reasonCategory: "wording-needs-improvement",
    reasonSummary: "Good branch, just sharpen the wording.",
    reviewedAt: "2026-03-29T09:35:00Z"
  },
  {
    objectType: "review_feedback_item",
    reviewFeedbackId: "rf_fixture_duplicate",
    reviewItemId: "rh_boi_apr_followup",
    candidateMarketId: "cm_boi_mar_duplicate",
    lineageId: "lin_boi_rate_decisions",
    action: "merge",
    reasonCategory: "duplicate-or-overlap",
    reasonSummary: "Too overlapping with the main March decision.",
    reviewedAt: "2026-03-29T09:36:00Z"
  }
];
