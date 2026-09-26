import { compactWhitespace } from "./text";

export type SignalCategoryInput = {
  sourceId: string;
  category: string;
  title: string;
  summary: string;
  whyNow: string;
  keyEntities?: string[];
  tags?: string[];
};

const categoryKeywords: Record<string, RegExp[]> = {
  economy: [
    /\binterest rate\b/i,
    /\brate decision\b/i,
    /\binflation\b/i,
    /\bcpi\b/i,
    /\bcentral bank\b/i,
    /\bbank of israel\b/i,
    /ריבית/u,
    /אינפלציה/u,
    /מדד/u,
    /בנק ישראל/u,
    /שקל/u,
    /דולר/u,
    /נפט/u,
    /גז טבעי/u
  ],
  politics: [
    /\belection\b/i,
    /\bpoll\b/i,
    /\bcoalition\b/i,
    /\bprime minister\b/i,
    /\bminister\b/i,
    /\bknesset\b/i,
    /\bmayor\b/i,
    /בחירות/u,
    /סקר/u,
    /קואליציה/u,
    /ממשלה/u,
    /כנסת/u,
    /פוליטיק/u,
    /ראש העיר/u,
    /ראש הממשלה/u,
    /שר\b/u
  ],
  sports: [
    /\bbasketball\b/i,
    /\bfootball\b/i,
    /\bsoccer\b/i,
    /\bderby\b/i,
    /\bfinal\b/i,
    /\bsemi[- ]?final\b/i,
    /\bleague\b/i,
    /\bcup\b/i,
    /\bnba\b/i,
    /\beuroleague\b/i,
    /\batp\b/i,
    /\bmonte[\s-]?carlo\b/i,
    /\bmarathon\b/i,
    /\bufc\b/i,
    /\besports?\b/i,
    /\bvalorant\b/i,
    /\bleague of legends\b/i,
    /\blol esports\b/i,
    /\bcounter[- ]?strike\b/i,
    /\bcs2\b/i,
    /\bdota(?:\s*2)?\b/i,
    /\b[a-z0-9 .'-]+ vs [a-z0-9 .'-]+\b/i,
    /\bbarcelona\b/i,
    /\bbarca\b/i,
    /\batletico\b/i,
    /\bchelsea\b/i,
    /\bman(?:chester)? city\b/i,
    /\balcaraz\b/i,
    /\bmessi\b/i,
    /כדורגל/u,
    /כדורסל/u,
    /מרתון/u,
    /מכבי/u,
    /הפועל/u,
    /בית"ר/u,
    /צ['׳]לסי/u,
    /מנצ['׳]סטר סיטי/u,
    /אתלטיקו/u,
    /מסי/u,
    /אלקראז/u,
    /אמבפה/u,
    /גמר/u,
    /חצי גמר/u,
    /ליגה/u,
    /גביע/u
  ],
  culture: [
    /\beurovision\b/i,
    /\bmovie\b/i,
    /\bseries\b/i,
    /\baward\b/i,
    /\bsinger\b/i,
    /\bactor\b/i,
    /\bsong\b/i,
    /אירוויזיון/u,
    /סדרה/u,
    /סרט/u,
    /שיר/u,
    /זמר/u,
    /זמרת/u,
    /פרס/u
  ],
  security: [
    /\balert\b/i,
    /\bsiren\b/i,
    /\bmissile\b/i,
    /\brocket\b/i,
    /\bterror\b/i,
    /\bdefensive policy\b/i,
    /\bhome front\b/i,
    /\bemergency\b/i,
    /אזעק(?:ה|ות)?/u,
    /טיל/u,
    /(^|[^\p{Letter}])רקט(?:ה|ות)?([^\p{Letter}]|$)/u,
    /פיקוד העורף/u,
    /כוננות/u,
    /התרע(?:ה|ות)?/u,
    /פיגוע/u,
    /לחימה/u,
    /איראן/u,
    /עבאס עראק/u,
    /ארדואן/u,
    /ישראל כ[״"]?ץ/u
  ],
  travel: [
    /\bairport\b/i,
    /\bflight\b/i,
    /\bairspace\b/i,
    /\bairline\b/i,
    /\bben gurion\b/i,
    /טיסה/u,
    /שדה התעופה/u,
    /נתב"ג/u,
    /מרחב האוויר/u,
    /תעופה/u
  ],
  technology: [/\bai\b/i, /\bchip\b/i, /\bstartup\b/i, /\biphone\b/i, /בינה מלאכותית/u, /שבב/u, /סטארטאפ/u],
  science: [
    /\bearthquake\b/i,
    /\bquake\b/i,
    /\bcyclone\b/i,
    /\bstorm\b/i,
    /\bflood\b/i,
    /\bvolcano\b/i,
    /\bwildfire\b/i,
    /\bgdacs\b/i,
    /\busgs\b/i,
    /רעידת אדמה/u,
    /רעידה/u,
    /שיטפון/u,
    /סערה/u,
    /שריפה/u
  ]
};

export function isPoliticalOrSecurityPerson(text: string): boolean {
  return [
    /ישראל כ[״"]?ץ/u,
    /איתמר בן גביר/u,
    /יאיר לפיד/u,
    /עבאס עראק/u,
    /ארדואן/u,
    /ויקטור אורבן/u,
    /נשיא אוקראינה/u,
    /קרן טרנר/u,
    /שאול מרידור/u,
    /\bminister\b/i,
    /\bpresident\b/i
  ].some((expression) => expression.test(text));
}

function isSecurityPerson(text: string): boolean {
  return [/ישראל כ[״"]?ץ/u, /עבאס עראק/u, /ארדואן/u, /נשיא אוקראינה/u, /איראן/u].some((expression) =>
    expression.test(text)
  );
}

export function normalizeCategory(category: string): string {
  const normalized = category.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "general";
}

export function buildSignalText(input: SignalCategoryInput): string {
  const normalizedSummary = input.summary
    .replace(/coverage sources:[^.]+\.?/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ");

  return compactWhitespace(
    [
      input.title,
      normalizedSummary,
      input.whyNow,
      ...(input.keyEntities ?? []),
      ...(input.tags ?? [])
    ].join(" ")
  ).toLowerCase();
}

function countMatches(text: string, expressions: RegExp[]): number {
  return expressions.reduce((count, expression) => count + (expression.test(text) ? 1 : 0), 0);
}

export function inferCategory(input: SignalCategoryInput, text: string): { category: string; note?: string } {
  const sourceCategory = normalizeCategory(input.category);

  if (input.sourceId === "src_home_front_command") {
    return { category: "security" };
  }

  if (input.sourceId === "src_iaa_notifications") {
    return { category: "travel" };
  }

  if (input.sourceId === "src_federal_reserve_rss" || input.sourceId === "src_ecb_rss" || input.sourceId === "src_imf_news") {
    return { category: "economy" };
  }

  if (input.sourceId === "src_usgs_alerts" || input.sourceId === "src_gdacs_alerts") {
    return { category: "science" };
  }

  if (isSecurityPerson(text)) {
    return {
      category: "security",
      note: sourceCategory !== "security" ? "Category inferred as security from political/security entity language." : undefined
    };
  }

  if (isPoliticalOrSecurityPerson(text)) {
    return {
      category: "politics",
      note: sourceCategory !== "politics" ? "Category inferred as politics from public-figure language." : undefined
    };
  }

  const scores = Object.entries(categoryKeywords)
    .map(([category, expressions]) => [category, countMatches(text, expressions)] as const)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);

  if (scores.length === 0) {
    return { category: sourceCategory };
  }

  const [bestCategory] = scores[0]!;

  if (sourceCategory !== "general" && sourceCategory !== "unknown" && sourceCategory !== bestCategory) {
    return { category: sourceCategory };
  }

  return {
    category: bestCategory,
    note: bestCategory !== sourceCategory ? `Category inferred as ${bestCategory} from signal language.` : undefined
  };
}
