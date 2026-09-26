import type {
  CandidateMarket,
  LineageRef,
  ManualSeerSignal,
  MarketCreationDraft,
  MarketCreationDraftSnapshot,
  MarketFamilyRegistryEntry,
  OperatorLead,
  PlannedRegistrySnapshot,
  PlatformShapeSnapshot,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  ReviewQueueSections,
  ReviewQueueSnapshot,
  ReworkAttemptItem,
  SeerCommand,
  SourceFamilyRequest,
  SourceFamilyRequestSnapshot,
  SourceRegistryEntry,
  TrackedEvent
} from "./contracts";
import type { MarketCreationReadinessItem } from "./creation-drafts";
import type { FamilyReadinessSnapshot } from "./family-readiness";
import type { HeartbeatSourceRun } from "./heartbeat";
import type { SeerSignal } from "./pipeline";

export type SeerPayload = {
  command: SeerCommand;
  generatedAt: string;
  sourceRegistry?: SourceRegistryEntry[];
  marketFamilies?: MarketFamilyRegistryEntry[];
  familyReadinessSnapshot?: FamilyReadinessSnapshot;
  sourceEntry?: SourceRegistryEntry;
  sourceRegistryPath?: string;
  platformShapesPath?: string;
  importedSignals?: ManualSeerSignal[];
  operatorLead?: OperatorLead;
  operatorLeads?: OperatorLead[];
  operatorLeadLogPath?: string;
  operatorLeadsPath?: string;
  importedCount?: number;
  importFile?: string;
  intakeLogPath?: string;
  lineages?: LineageRef[];
  trackedEvents?: TrackedEvent[];
  candidateMarkets?: CandidateMarket[];
  reviewQueue?: ReviewHandoffItem[];
  reviewQueueSections?: ReviewQueueSections;
  reviewQueueSnapshot?: ReviewQueueSnapshot | null;
  reviewQueueHistory?: ReviewQueueSnapshot[];
  plannedRegistrySnapshot?: PlannedRegistrySnapshot | null;
  plannedRegistryHistory?: PlannedRegistrySnapshot[];
  plannedRegistryPath?: string;
  plannedRegistryHistoryPath?: string;
  sourceFamilyRequests?: SourceFamilyRequest[];
  sourceFamilyRequestSnapshot?: SourceFamilyRequestSnapshot | null;
  sourceFamilyRequestsPath?: string;
  sourceFamilyRequestHistoryPath?: string;
  reviewQueuePath?: string;
  reviewQueueHistoryPath?: string;
  feedbackItem?: ReviewFeedbackItem;
  feedbackLog?: ReviewFeedbackItem[];
  feedbackLogPath?: string;
  reworkAttempt?: ReworkAttemptItem;
  reworkAttempts?: ReworkAttemptItem[];
  reworkLogPath?: string;
  marketCreationDrafts?: MarketCreationDraft[];
  marketCreationReadiness?: MarketCreationReadinessItem[];
  marketCreationDraftSnapshot?: MarketCreationDraftSnapshot | null;
  marketCreationDraftHistory?: MarketCreationDraftSnapshot[];
  marketCreationDraftsPath?: string;
  marketCreationDraftHistoryPath?: string;
  platformShapeSnapshots?: PlatformShapeSnapshot[];
  heartbeatSummary?: {
    fetchedCount: number;
    importedCount: number;
    skippedCount: number;
    sourceRuns: HeartbeatSourceRun[];
  };
  signals?: SeerSignal[];
};
