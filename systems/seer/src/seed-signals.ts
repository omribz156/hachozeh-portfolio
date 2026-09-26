import type {
  IntakeLane,
  MarketForm,
  ProposedOutcome,
  RecurringEventTemplateId,
  SensitivityLevel,
  SourceClass
} from "./contracts";
import { buildKnessetDissolutionBeforeDateTemplate } from "./planned-event-templates";

export type SeerSeedSignal = {
  signalId: string;
  sourceId: string;
  intakeLane: IntakeLane;
  recurringTemplateId?: RecurringEventTemplateId;
  clusterKey: string;
  lineageLabel: string;
  title: string;
  summary: string;
  category: string;
  whyNow: string;
  observedAt: string;
  sourceClass: SourceClass;
  sourceRef: string;
  sourceLabel: string;
  keyEntities: string[];
  question: string;
  marketAngle: string;
  marketForm: MarketForm;
  proposedOutcomes: ProposedOutcome[];
  marketWorthiness: string;
  resolutionFeasibility: string;
  sourceSummary: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sensitivityLevel?: SensitivityLevel;
  ambiguityNotes?: string[];
  riskFlags?: string[];
};

const eurovisionOutcomes: ProposedOutcome[] = [
  { label: "Sweden", kind: "named-outcome" },
  { label: "Israel", kind: "named-outcome" },
  { label: "Italy", kind: "named-outcome" },
  { label: "Other", kind: "named-outcome" }
];

const knessetDissolutionAprilTemplate = buildKnessetDissolutionBeforeDateTemplate("April 30, 2026");
const knessetDissolutionMayTemplate = buildKnessetDissolutionBeforeDateTemplate("May 31, 2026");

export const seerSeedSignals: SeerSeedSignal[] = [
  {
    signalId: "sig_knesset_dissolution_before_april_2026",
    sourceId: "src_knesset_official",
    intakeLane: "planned",
    recurringTemplateId: "knesset-dissolution-before-date-v1",
    clusterKey: "knesset-dissolution-before-april-2026",
    lineageLabel: "knesset-dissolution-2026",
    title: "Knesset dissolution before end of April 2026",
    summary: "Bounded political family probe for whether the Knesset dissolves before the end of April 2026.",
    category: "politics",
    whyNow: "משפחת שווקים פוליטית תחומה בזמן צריכה שני מועדי יעד קרובים כדי לבדוק אם המשפחה והמקורות מחזיקים.",
    observedAt: "2026-04-16T12:50:00Z",
    sourceClass: "authority",
    sourceRef: "https://main.knesset.gov.il/",
    sourceLabel: "הכנסת",
    keyEntities: ["הכנסת", "פיזור הכנסת", "בחירות"],
    question: knessetDissolutionAprilTemplate.question,
    marketAngle: knessetDissolutionAprilTemplate.marketAngle,
    marketForm: knessetDissolutionAprilTemplate.marketForm,
    proposedOutcomes: knessetDissolutionAprilTemplate.proposedOutcomes,
    marketWorthiness: knessetDissolutionAprilTemplate.marketWorthiness,
    resolutionFeasibility: knessetDissolutionAprilTemplate.resolutionFeasibility,
    sourceSummary: "משפחת שוק פוליטית תחומה בזמן, עם עיגון פתרון רשמי דרך הכנסת.",
    suggestedCloseShape: knessetDissolutionAprilTemplate.suggestedCloseShape,
    suggestedResolutionAnchor: knessetDissolutionAprilTemplate.suggestedResolutionAnchor,
    sensitivityLevel: knessetDissolutionAprilTemplate.sensitivityLevel,
    ambiguityNotes: knessetDissolutionAprilTemplate.ambiguityNotes
  },
  {
    signalId: "sig_knesset_dissolution_before_may_2026",
    sourceId: "src_knesset_official",
    intakeLane: "planned",
    recurringTemplateId: "knesset-dissolution-before-date-v1",
    clusterKey: "knesset-dissolution-before-may-2026",
    lineageLabel: "knesset-dissolution-2026",
    title: "Knesset dissolution before end of May 2026",
    summary: "Second bounded political sibling for whether the Knesset dissolves before the end of May 2026.",
    category: "politics",
    whyNow: "אח שני באותה משפחת שווקים פוליטית, כדי לבדוק rail משפחתי, יצירת שוק, והרחבת מקורות באותו שלד.",
    observedAt: "2026-04-16T12:50:30Z",
    sourceClass: "authority",
    sourceRef: "https://main.knesset.gov.il/",
    sourceLabel: "הכנסת",
    keyEntities: ["הכנסת", "פיזור הכנסת", "בחירות"],
    question: knessetDissolutionMayTemplate.question,
    marketAngle: knessetDissolutionMayTemplate.marketAngle,
    marketForm: knessetDissolutionMayTemplate.marketForm,
    proposedOutcomes: knessetDissolutionMayTemplate.proposedOutcomes,
    marketWorthiness: knessetDissolutionMayTemplate.marketWorthiness,
    resolutionFeasibility: knessetDissolutionMayTemplate.resolutionFeasibility,
    sourceSummary: "אח נוסף במשפחת שוק פוליטית תחומה בזמן, עם עיגון פתרון רשמי דרך הכנסת.",
    suggestedCloseShape: knessetDissolutionMayTemplate.suggestedCloseShape,
    suggestedResolutionAnchor: knessetDissolutionMayTemplate.suggestedResolutionAnchor,
    sensitivityLevel: knessetDissolutionMayTemplate.sensitivityLevel,
    ambiguityNotes: knessetDissolutionMayTemplate.ambiguityNotes
  },
  {
    signalId: "sig_eurovision_news_burst",
    sourceId: "src_news_burst_eurovision",
    intakeLane: "planned",
    clusterKey: "eurovision-2026-winner",
    lineageLabel: "eurovision-winner-markets",
    title: "Eurovision 2026 winner race",
    summary: "Coverage and predictions are rising around Eurovision 2026 contenders.",
    category: "culture",
    whyNow: "The event is approaching and contender narratives are getting sharper.",
    observedAt: "2026-03-28T11:10:00Z",
    sourceClass: "attention",
    sourceRef: "news-burst:eurovision-2026",
    sourceLabel: "news burst",
    keyEntities: ["Eurovision", "contest winner", "national entries"],
    question: "Which country will win Eurovision 2026?",
    marketAngle: "Named-outcome winner market for a known public event.",
    marketForm: "multi-outcome",
    proposedOutcomes: eurovisionOutcomes,
    marketWorthiness: "High public interest, clear event framing, and strong scanable outcome shape.",
    resolutionFeasibility: "Official Eurovision result publication should determine the winner cleanly.",
    sourceSummary: "Fast-moving coverage shows broad attention and contender focus.",
    suggestedCloseShape: "Close before final performance voting ends.",
    suggestedResolutionAnchor: "Official Eurovision final results publication.",
    sensitivityLevel: "elevated",
    ambiguityNotes: ["Outcome set may need refinement if contender mix changes materially."]
  },
  {
    signalId: "sig_eurovision_official_schedule",
    sourceId: "src_eurovision_official",
    intakeLane: "planned",
    clusterKey: "eurovision-2026-winner",
    lineageLabel: "eurovision-winner-markets",
    title: "Eurovision 2026 winner race",
    summary: "Official Eurovision scheduling gives a clean event anchor for publication and later settlement.",
    category: "culture",
    whyNow: "The event window is known and public attention is already warming up.",
    observedAt: "2026-03-28T11:18:00Z",
    sourceClass: "authority",
    sourceRef: "eurovision.tv",
    sourceLabel: "Eurovision official",
    keyEntities: ["Eurovision", "contest winner", "national entries"],
    question: "Which country will win Eurovision 2026?",
    marketAngle: "Named-outcome winner market for a known public event.",
    marketForm: "multi-outcome",
    proposedOutcomes: eurovisionOutcomes,
    marketWorthiness: "Strong public event with clean external settlement anchor.",
    resolutionFeasibility: "Official final scoreboard should settle the market with low ambiguity.",
    sourceSummary: "Official event source confirms the timeline and authority path.",
    suggestedCloseShape: "Close before the official winner announcement.",
    suggestedResolutionAnchor: "Official Eurovision final scoreboard.",
    sensitivityLevel: "elevated"
  }
];
