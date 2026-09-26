export type SourceClass = "attention" | "context" | "authority" | "internal";

export type SourceAccessSurface =
  | "html"
  | "rss"
  | "api"
  | "calendar"
  | "dataset"
  | "account"
  | "internal-stream"
  | "manual-import";

export type SourceRegistryStatus = "seeded" | "observed" | "trusted" | "watch-only" | "paused" | "retired";

export type SourceCurationMode = "manual-seed" | "bottom-up-observed" | "lineage-expanded" | "internal-native";

export type SourceStage = "sensing" | "grounding" | "review";

export type SourceSpeedProfile = "fast" | "medium" | "slow" | "event-bound";

export type SourceNoiseProfile = "low" | "medium" | "high";

export type SourceAuthorityProfile = "low" | "medium" | "high" | "official";

export type ResolutionAuthorityType = "official" | "canonical-data" | "credible-reporting" | "platform-defined";

export type MarketMeasurementKind =
  | "final_winner"
  | "rate_direction"
  | "deadline_yes_no"
  | "threshold_crossing"
  | "date_bucket"
  | "official_value"
  | "reported_claim";

export type MarketResultShape =
  | "home_away_winner"
  | "three_way_result"
  | "cut_hold_hike"
  | "yes_no"
  | "date_bucket"
  | "multi_outcome";

export type OracleCapabilityStatus =
  | "supported_full_cycle"
  | "supported_final_only"
  | "credible_reporting"
  | "manual_resolution_required"
  | "blocked";

export type SourceJob =
  | "notice-motion"
  | "spot-weak-signals"
  | "explain-context"
  | "shape-wording"
  | "ground-confidence"
  | "anchor-resolution"
  | "measure-user-demand"
  | "reactivate-lineage";

export type ExternalPlatform = "polymarket" | "kalshi";

export type ConfidenceLabel = "low" | "medium" | "high" | "unknown";

export type LineageStatus = "active" | "dormant" | "cooling" | "retired";

export type TrackedEventStatus = "active" | "holding" | "cooling" | "escalated" | "merged";

export type TrackedEventMaturity = "emerging" | "developing" | "grounded";

export type NextSuggestedAction = "keep-watching" | "propose-market" | "merge" | "cool-down" | "escalate";

export type CandidateMarketStatus =
  | "candidate"
  | "grounded"
  | "review-ready"
  | "held"
  | "merged"
  | "rejected"
  | "escalated"
  | "rework-requested";

export type MarketForm = "binary" | "multi-outcome" | "date-bucket" | "threshold" | "range";

export type DuplicateAssessment = "distinct" | "close-sibling" | "likely-duplicate" | "follow-up-branch";

export type EventResolutionPolicy = "independent_children" | "exclusive_first_hit";

export type SensitivityLevel = "normal" | "elevated" | "high";

export type CanonicalIntakeLane = "planned" | "live";

export type LegacyIntakeLane = "planned-event" | "shock-discovery";

export type IntakeLane = CanonicalIntakeLane | LegacyIntakeLane;

export type RecurringEventTemplateId =
  | "boi-rate-decision-v1"
  | "fed-rate-decision-v1"
  | "ecb-rate-decision-v1"
  | "knesset-dissolution-before-date-v1"
  | "sports-match-winner-v1"
  | "sports-regulation-3way-v1";

export type SportsRecurringTemplateId = Extract<
  RecurringEventTemplateId,
  "sports-match-winner-v1" | "sports-regulation-3way-v1"
>;

export type SignalTopicKind =
  | "market-shaped"
  | "scheduled-decision"
  | "measurable-indicator"
  | "winner-race"
  | "team-or-competition-buzz"
  | "policy-update"
  | "public-safety-alert"
  | "infrastructure-disruption"
  | "person-buzz"
  | "general-attention";

export type SignalMarketability = "watch-only" | "follow-up-needed" | "draft-ready" | "already-shaped";

export type SignalEnrichment = {
  sourceCategory: string;
  inferredCategory: string;
  topicKind: SignalTopicKind;
  marketability: SignalMarketability;
  inferenceNotes: string[];
  draftRecurringTemplateId?: RecurringEventTemplateId;
  draftClusterHint?: string;
  draftLineageHint?: string;
  draftQuestion?: string;
  draftMarketAngle?: string;
  draftMarketForm?: MarketForm;
  draftOutcomes?: ProposedOutcome[];
  draftMarketWorthiness?: string;
  draftResolutionFeasibility?: string;
  draftSuggestedCloseShape?: string;
  draftSuggestedResolutionAnchor?: string;
  draftSensitivityLevel?: SensitivityLevel;
  draftAmbiguityNotes?: string[];
  draftRiskFlags?: string[];
};

export type OutcomeKind = "binary-side" | "named-outcome" | "date-bucket" | "threshold-band" | "range-band";

export type ReviewMaturity = "emerging" | "developing" | "grounded" | "review-ready";

export type LineageContext = "new-market" | "sibling-candidate" | "follow-up-branch" | "possible-duplicate";

export type RecommendedAction = "approve" | "approve-with-edits" | "hold" | "merge" | "reject" | "escalate" | "request-rework";

export type ReviewReasonCategory =
  | "good-as-is"
  | "wording-needs-improvement"
  | "outcome-structure-needs-improvement"
  | "duplicate-or-overlap"
  | "too-early"
  | "insufficient-grounding"
  | "non-resolvable"
  | "policy-risk"
  | "sensitivity-risk"
  | "proposal-quality-weak"
  | "fit"
  | "wording"
  | "duplicate"
  | "timing"
  | "outcomes"
  | "authority"
  | "sensitivity"
  | "other";

export type WorthinessFailureReason =
  | "stale-window"
  | "not-market-shaped"
  | "wording-too-vague"
  | "outcomes-not-clean"
  | "resolution-path-weak"
  | "relevance-too-low"
  | "likely-duplicate"
  | "sensitivity-escalation";

export type MarketShapingTier = "publish-ready" | "review-ready" | "needs-grounding" | "watch-only" | "reject";

export type MarketWorthinessDimension = {
  label: ConfidenceLabel;
  note: string;
};

export type MarketWorthinessAssessment = {
  objectType: "market_worthiness_assessment";
  reviewReadiness: ConfidenceLabel;
  marketShaping: {
    objectType: "market_shaping_assessment";
    tier: MarketShapingTier;
    score: number;
    maxScore: number;
    summary: string;
  };
  timeliness: MarketWorthinessDimension;
  marketShape: MarketWorthinessDimension;
  wordingClarity: MarketWorthinessDimension;
  outcomeShape: MarketWorthinessDimension;
  resolutionFeasibility: MarketWorthinessDimension;
  relevance: MarketWorthinessDimension;
  novelty: MarketWorthinessDimension;
  sensitivityRisk: MarketWorthinessDimension;
  failureReasons: WorthinessFailureReason[];
  summary: string;
};

export type ProposedOutcome = {
  label: string;
  kind?: OutcomeKind;
  notes?: string;
};

export type SourceRolePlan = {
  wake: string[];
  ground: string[];
  resolve: string[];
  integrity?: string[];
  notes?: string[];
};

export type MarketContractBlocker =
  | "missing-measurement"
  | "missing-close-shape"
  | "missing-resolution-source"
  | "missing-source-url"
  | "missing-resolution-rule"
  | "missing-outcome-map"
  | "fetch-needs-open";

export type MarketContractOutcomeMapItem = {
  outcomeLabel: string;
  outcomeKind?: OutcomeKind;
  resolutionPath: string;
  evidenceKey?: string;
};

export type MarketImageBucket = "entity" | "event" | "source" | "category-fallback";

export type MarketImageRightsStatus =
  | "hachozeh-owned"
  | "licensed"
  | "approved-third-party"
  | "internal-only"
  | "unverified";

export type MarketImagePublicUse = "allowed" | "internal-only" | "blocked";

export type MarketContractImage = {
  bucket: MarketImageBucket;
  assetId?: string;
  src: string;
  alt: string;
  provenance: string;
  theme?: {
    primary: string;
    secondary: string;
    surface: string;
    accentReason: string;
    source: string;
  };
  rights: {
    status: MarketImageRightsStatus;
    publicUse: MarketImagePublicUse;
    owner: string;
    sourceUrl?: string;
    notes?: string[];
  };
  notes?: string[];
};

export type MarketTaxonomyV1 = {
  objectType: "market_taxonomy_v1";
  visibleTags: string[];
  category?: string;
  family?: string;
  entities?: string[];
  aliases?: string[];
  sourceIds?: string[];
  geography?: string[];
  language?: string[];
  shape?: MarketForm;
};

export type MarketContractV1 = {
  objectType: "market_contract_v1";
  version: "seer-contract-v1";
  marketKindId?: string;
  operational?: {
    environment?: "prod" | "test";
    createdFor?: string;
    runId?: string;
    notes?: string[];
  };
  measurement: string;
  measurementKind?: MarketMeasurementKind;
  resultShape?: MarketResultShape;
  oracleCapability?: OracleCapabilityStatus;
  displayHints?: {
    binaryPresentation?: "yes_no" | "named_opponents";
    affirmativeLabel?: string;
    negativeLabel?: string;
    notes?: string[];
  };
  resolutionAuthorityType: ResolutionAuthorityType;
  resolutionSource: {
    label: string;
    url: string | null;
    sourceIds?: string[];
  };
  resolutionRule: string;
  lifecycleFit?: "event_full_cycle" | "scheduled_measurement" | "credible_reporting" | "manual_exception";
  allowFallbackResolution?: boolean;
  fallbackEvidenceStandard?: string;
  credibleReporting?: {
    minimumIndependentSources?: number;
    approvedSourceIds?: string[];
    conflictPolicy?: string;
    correctionWindow?: string;
    requiresHumanReview?: boolean;
  };
  timeline: {
    closeShape: string;
    closeAt: string | null;
    expectedResolutionAt?: string | null;
    timezone: "UTC" | "unknown";
    notes?: string[];
  };
  outcomeMap: MarketContractOutcomeMapItem[];
  delayPolicy: string;
  payoutPolicy: string;
  dataRevisionPolicy?: string;
  ambiguityPolicy?: string;
  image: MarketContractImage;
  taxonomy?: MarketTaxonomyV1;
  reviewBlockers: MarketContractBlocker[];
  sourceRolePlan?: SourceRolePlan;
};

export type DraftOracleSourcePolicy = {
  preferredSourceIds?: string[];
  fallbackSourceIds?: string[];
  contextSourceIds?: string[];
  closeConditionSourceIds?: string[];
  resolutionSourceIds?: string[];
  requiresHumanReviewOnSourceConflict?: boolean;
  requiresHumanReviewOnWeakAuthority?: boolean;
  notes?: string[];
};

export type SourceLifecycleCapabilityHint = {
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
  oracleCapability: OracleCapabilityStatus;
  notes?: string[];
};

export type MarketFamilyAdapterReadiness =
  | "built"
  | "adapter_needed"
  | "manual_allowed"
  | "policy_review";

export type MarketFamilySourceCandidate = {
  sourceId: string;
  label: string;
  route: {
    measurementKind: MarketMeasurementKind;
    resultShape: MarketResultShape;
  };
  adapterReadiness: MarketFamilyAdapterReadiness;
  notes?: string[];
};

export type MarketFamilyRegistryEntry = {
  objectType: "market_family_registry_entry";
  /**
   * Stable market-kind id used by lifecycle creation.
   * Kept as familyKey for DB/back-compat with older drafts/events.
   */
  familyKey: string;
  category: string;
  labelHe: string;
  labelEn: string;
  marketForms: MarketForm[];
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
  namingPatternHe: string;
  closePolicy: string;
  resolutionPolicy: string;
  sensitivityLevel: SensitivityLevel;
  operatorDecisionRequired: true;
  sourceCandidates: MarketFamilySourceCandidate[];
  recurringTemplateIds?: RecurringEventTemplateId[];
  exampleQuestions?: string[];
  keywords?: string[];
  notes?: string[];
};

export type MarketFamilyClassificationStatus =
  | "classified"
  | "source_family_needed"
  | "adapter_needed"
  | "policy_review"
  | "family_proposal"
  | "blocked";

export type MarketFamilyClassification = {
  objectType: "market_family_classification";
  status: MarketFamilyClassificationStatus;
  familyKey: string | null;
  familyLabelHe: string | null;
  category: string;
  measurementKind?: MarketMeasurementKind;
  resultShape?: MarketResultShape;
  oracleCapability?: OracleCapabilityStatus;
  matchedSourceIds: string[];
  operatorNextAction:
    | "operator_decide"
    | "pick_source_family"
    | "run_oracle_capability_check"
    | "build_oracle_adapter"
    | "policy_review"
    | "create_family_proposal"
    | "park_family";
  confidence: ConfidenceLabel;
  reasons: string[];
  blockers: string[];
};

export type SourceFamilyRequestStatus =
  | "adapter_needed"
  | "blocked_by_contract"
  | "manual_resolution_requested";

export type SourceFamilyRequest = {
  objectType: "source_family_request";
  requestId: string;
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string | null;
  measurementKind: MarketMeasurementKind;
  resultShape: MarketResultShape;
  resolutionAuthorityType: ResolutionAuthorityType;
  status: SourceFamilyRequestStatus;
  marketFamilyKey?: string;
  marketFamilyLabelHe?: string;
  marketFamilyClassificationStatus?: MarketFamilyClassificationStatus;
  requestedByCandidateMarketIds: string[];
  requestedByReviewItemIds: string[];
  exampleQuestions: string[];
  operatorNextAction: "run_oracle_capability_check" | "build_oracle_adapter" | "park_family";
  createdAt: string;
  updatedAt: string;
  notes?: string[];
};

export type SourceFamilyRequestSnapshot = {
  objectType: "source_family_request_snapshot";
  snapshotId: string;
  generatedAt: string;
  itemCount: number;
  items: SourceFamilyRequest[];
};

export type SourceRegistryEntry = {
  objectType: "source_registry_entry";
  sourceId: string;
  label: string;
  primaryClass: SourceClass;
  accessSurface: SourceAccessSurface;
  status: SourceRegistryStatus;
  curationMode: SourceCurationMode;
  stageUsefulness: SourceStage[];
  categoryFit: string[];
  createdAt: string;
  updatedAt: string;
  ownerLabel?: string;
  homepage?: string;
  accessHints?: string[];
  secondaryClasses?: SourceClass[];
  primaryJobs?: SourceJob[];
  speedProfile?: SourceSpeedProfile;
  noiseProfile?: SourceNoiseProfile;
  authorityProfile?: SourceAuthorityProfile;
  independentGroupId?: string;
  domainPatterns?: string[];
  credibleReporting?: {
    allowed: boolean;
    tier?: "primary" | "supporting" | "context-only";
    notes?: string[];
  };
  domainNotes?: string[];
  lineageAffinity?: string[];
  seerPath?: string;
  lastSeenAt?: string;
  lastUsefulAt?: string;
  reviewNotes?: string[];
  flags?: string[];
  lifecycleCapabilities?: SourceLifecycleCapabilityHint[];
};

export type ManualSeerSignal = {
  objectType: "manual_seer_signal";
  signalId: string;
  sourceId: string;
  intakeLane?: IntakeLane;
  recurringTemplateId?: RecurringEventTemplateId;
  title: string;
  summary: string;
  category: string;
  whyNow: string;
  observedAt: string;
  importedAt: string;
  sourceRef?: string;
  sourceLabel?: string;
  clusterHint?: string;
  lineageHint?: string;
  keyEntities?: string[];
  notes?: string[];
  tags?: string[];
  question?: string;
  marketAngle?: string;
  marketForm?: MarketForm;
  proposedOutcomes?: ProposedOutcome[];
  marketWorthiness?: string;
  resolutionFeasibility?: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sensitivityLevel?: SensitivityLevel;
  ambiguityNotes?: string[];
  riskFlags?: string[];
  draftedByEnrichment?: boolean;
};

export type LineageRef = {
  objectType: "lineage_ref";
  lineageId: string;
  lineageLabel: string;
  category: string;
  status: LineageStatus;
  lineageSummary: string;
  createdAt: string;
  updatedAt: string;
  parentEventLabel?: string;
  currentFocus?: string;
  keyEntities?: string[];
  relatedCandidateIds?: string[];
  lastHeartbeatAt?: string;
  notes?: string[];
};

export type TrackedEvent = {
  objectType: "tracked_event";
  trackedEventId: string;
  eventLane?: CanonicalIntakeLane;
  title: string;
  summary: string;
  category: string;
  status: TrackedEventStatus;
  maturity: TrackedEventMaturity;
  signalStrength: ConfidenceLabel;
  relevanceStrength: ConfidenceLabel;
  sourceClassesSeen: SourceClass[];
  whyNow: string;
  lastObservedAt: string;
  nextSuggestedAction: NextSuggestedAction;
  createdAt: string;
  updatedAt: string;
  lineageId?: string;
  keyEntities?: string[];
  topSourceRefs?: string[];
  liveEvent?: LiveEventUnderstandingV0;
  notes?: string[];
};

export type LiveEventUnderstandingV0 = {
  objectType: "live_event_understanding_v0";
  claim: string;
  observedAt: string;
  evidenceRefs: string[];
  evidenceSourceIds: string[];
  groundingNeeds: string[];
  marketability: SignalMarketability;
  authorityReadiness: ConfidenceLabel;
  nextGate: "ground-sources" | "shape-market" | "review-ready" | "park";
  notes?: string[];
};

export type CandidateMarket = {
  objectType: "candidate_market";
  candidateMarketId: string;
  trackedEventId: string;
  intakeLane?: IntakeLane;
  recurringTemplateId?: RecurringEventTemplateId;
  question: string;
  marketAngle: string;
  marketForm: MarketForm;
  proposedOutcomes: ProposedOutcome[];
  category: string;
  status: CandidateMarketStatus;
  whyNow: string;
  marketWorthiness: string;
  resolutionFeasibility: string;
  authorityReadiness: ConfidenceLabel;
  sourceSummary: string;
  duplicateAssessment: DuplicateAssessment;
  sensitivityLevel: SensitivityLevel;
  ambiguities: string[];
  riskFlags: string[];
  fetchNeeds?: string[];
  sourceRolePlan?: SourceRolePlan;
  contract?: MarketContractV1;
  familyClassification?: MarketFamilyClassification;
  worthinessAssessment: MarketWorthinessAssessment;
  marketShaping?: MarketWorthinessAssessment["marketShaping"];
  createdAt: string;
  updatedAt: string;
  lineageId?: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  topSourceRefs?: string[];
  topSourceIds?: string[];
  draftedByEnrichment?: boolean;
  notes?: string[];
};

export type ReviewHandoffItem = {
  objectType: "review_handoff_item";
  reviewItemId: string;
  candidateMarketId: string;
  intakeLane?: IntakeLane;
  recurringTemplateId?: RecurringEventTemplateId;
  category: string;
  headline: string;
  question: string;
  marketForm: MarketForm;
  proposedOutcomes: ProposedOutcome[];
  whyNow: string;
  decisionSummary: string;
  maturity: ReviewMaturity;
  confidence: ConfidenceLabel;
  authorityReadiness: ConfidenceLabel;
  lineageContext: LineageContext;
  topSupport: string;
  topRisks: string[];
  fetchNeeds?: string[];
  sourceRolePlan?: SourceRolePlan;
  contract?: MarketContractV1;
  familyClassification?: MarketFamilyClassification;
  recommendedAction: RecommendedAction;
  recommendedActionWhy: string;
  worthinessSummary?: string;
  marketShaping?: MarketWorthinessAssessment["marketShaping"];
  failureReasons?: WorthinessFailureReason[];
  createdAt: string;
  lineageId?: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sensitivityLevel?: SensitivityLevel;
  reviewHints?: string[];
  topSourceRefs?: string[];
  topSourceIds?: string[];
  draftedByEnrichment?: boolean;
};

export type MarketDraftOutcome = {
  outcomeId: string | null;
  label: string;
  shortLabel: string | null;
  description: string | null;
  colorKey: string | null;
};

export type MarketCreationDraft = {
  objectType: "market_creation_draft";
  creationDraftId: string;
  reviewItemId: string;
  candidateMarketId: string;
  familyKey?: string;
  eventId?: string;
  eventTitle?: string;
  eventDescription?: string | null;
  eventIcon?: string | null;
  eventResolutionPolicy?: EventResolutionPolicy;
  eventChildLabel?: string;
  intakeLane?: IntakeLane;
  recurringTemplateId?: RecurringEventTemplateId;
  category: string;
  categoryKey: string | null;
  title: string;
  description: string | null;
  openAt: string;
  closeAt: string;
  resolutionSource: string;
  resolutionRules: string;
  oracleSourcePolicy: DraftOracleSourcePolicy | null;
  liquidityB: string;
  seedAmount?: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  outcomes: MarketDraftOutcome[];
  idempotencyKey: string;
  whyNow: string;
  createdAt: string;
  sourceRolePlan?: SourceRolePlan;
  contract?: MarketContractV1;
  familyClassification?: MarketFamilyClassification;
  marketShaping?: MarketWorthinessAssessment["marketShaping"];
  topSourceRefs?: string[];
  topSourceIds?: string[];
  marketEnvironment?: "prod" | "test";
  notes?: string[];
};

export type PlannedEventFamily = {
  objectType: "planned_event_family";
  familyId: string;
  label: string;
  category: string;
  recurringTemplateId?: RecurringEventTemplateId;
  sourceIds: string[];
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlannedEvent = {
  objectType: "planned_event";
  eventId: string;
  familyId: string;
  label: string;
  category: string;
  status: "confirmed";
  scheduledAt: string | null;
  closeShape?: string;
  sourceIds: string[];
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlannedMarketBinding = {
  objectType: "planned_market_binding";
  bindingId: string;
  familyId: string;
  eventId: string;
  candidateMarketId: string;
  reviewItemId: string;
  marketFamilyKey: string;
  question: string;
  category: string;
  recurringTemplateId?: RecurringEventTemplateId;
  resolutionAuthorityType?: ResolutionAuthorityType;
  duplicateKey: string;
  sourceIds: string[];
  sourceRefs: string[];
  createdAt: string;
};

export type PlannedRegistrySnapshot = {
  objectType: "planned_registry_snapshot";
  snapshotId: string;
  generatedAt: string;
  familyCount: number;
  eventCount: number;
  bindingCount: number;
  families: PlannedEventFamily[];
  events: PlannedEvent[];
  marketBindings: PlannedMarketBinding[];
};

export type OperatorLeadSourceType = "external_market" | "news" | "official_source" | "friend_tip" | "manual_note";

export type OperatorLeadRole = "shape_reference" | "attention_reference" | "source_candidate";

export type OperatorLeadStatus = "new" | "grounding" | "converted" | "parked" | "rejected";

export type OperatorLead = {
  objectType: "operator_lead";
  leadId: string;
  createdAt: string;
  createdBy: string;
  leadUrl?: string;
  leadSourceType: OperatorLeadSourceType;
  leadRole: OperatorLeadRole;
  rawPrompt: string;
  initialDomain: string;
  expectedLane: CanonicalIntakeLane;
  status: OperatorLeadStatus;
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

export type ReviewFeedbackItem = {
  objectType: "review_feedback_item";
  reviewFeedbackId: string;
  reviewItemId: string;
  candidateMarketId: string;
  action: RecommendedAction;
  reasonCategory: ReviewReasonCategory;
  reasonSummary: string;
  reviewedAt: string;
  lineageId?: string;
  editedCategory?: string;
  editedQuestion?: string;
  editedOutcomes?: ProposedOutcome[];
  editedCloseShape?: string;
  editedResolutionAnchor?: string;
  notes?: string[];
};

export type PlatformShapeExample = {
  objectType: "platform_shape_example";
  platform: ExternalPlatform;
  exampleId: string;
  title: string;
  category?: string;
  marketForm: MarketForm;
  referenceLane?: "reference-shapes";
  contractPattern?: "standard-contract" | "recurring-template" | "multi-market-event" | "combo-noise";
  familyHint?: string;
  qualityNotes?: string[];
  closeTime?: string;
  marketUrl?: string;
  sourceRef: string;
  volumeHint?: string;
  openInterestHint?: string;
  notes?: string[];
};

export type PlatformShapeSnapshot = {
  objectType: "platform_shape_snapshot";
  platform: ExternalPlatform;
  generatedAt: string;
  sourceId: string;
  fetchUrl: string;
  exampleCount: number;
  examples: PlatformShapeExample[];
  notes?: string[];
};

export type ReworkAttemptStatus = "auto-revised" | "needs-operator-input" | "no-safe-fix";

export type ReworkAttemptItem = {
  objectType: "rework_attempt_item";
  reworkAttemptId: string;
  candidateMarketId: string;
  reviewItemId: string;
  basedOnReviewFeedbackId: string;
  reviewedFingerprint: string;
  revisedFingerprint: string;
  status: ReworkAttemptStatus;
  reasonCategory: ReviewReasonCategory;
  reasonSummary: string;
  generatedAt: string;
  lineageId?: string;
  requiredChanges: string[];
  changeSummary: string;
  revisedQuestion?: string;
  revisedMarketForm?: MarketForm;
  revisedOutcomes?: ProposedOutcome[];
  notes?: string[];
};

export type ReviewQueueSections = {
  active: ReviewHandoffItem[];
  rework: ReviewHandoffItem[];
  reviewed: ReviewHandoffItem[];
};

export type ReviewQueueSnapshot = {
  objectType: "review_queue_snapshot";
  snapshotId: string;
  generatedAt: string;
  itemCount: number;
  items: ReviewHandoffItem[];
  queueSections?: ReviewQueueSections;
};

export type MarketCreationDraftSnapshot = {
  objectType: "market_creation_draft_snapshot";
  snapshotId: string;
  generatedAt: string;
  itemCount: number;
  items: MarketCreationDraft[];
};

export type SeerCommand =
  | "heartbeat"
  | "platform-shapes"
  | "operator-lead-add"
  | "operator-leads"
  | "import-signals"
  | "intake-log"
  | "source-add"
  | "sources"
  | "market-families"
  | "family-readiness"
  | "scan"
  | "cluster"
  | "propose"
  | "review-queue"
  | "queue-latest"
  | "queue-history"
  | "planned-registry"
  | "planned-registry-history"
  | "family-requests"
  | "family-requests-latest"
  | "review-feedback"
  | "feedback-log"
  | "rework-log"
  | "create-drafts"
  | "draft-readiness"
  | "drafts-latest"
  | "drafts-history";

export type MarketFamilyClassificationInput = {
  category?: string;
  question: string;
  marketForm: MarketForm;
  recurringTemplateId?: RecurringEventTemplateId;
  sourceIds?: string[];
  measurementKind?: MarketMeasurementKind;
  resultShape?: MarketResultShape;
  sensitivityLevel?: SensitivityLevel;
  feedback?: Pick<ReviewFeedbackItem, "editedCategory" | "editedQuestion" | "editedOutcomes">;
};
