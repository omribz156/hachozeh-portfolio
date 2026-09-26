// Curated registry of recurring-series hub pages (`/series/{familyKey}`), keyed by
// markets.market_family_key.
//
// A family renders a hub ONLY when it is listed here AND the backend returns >= 2
// published instances (gate in pages/series/[familyKey].astro). The registry IS the
// quality gate: editorial title/description/intro per series keeps every hub a real
// entity page, never a thin auto-generated one. Pre-registered families that don't yet
// have >= 2 dated instances simply 404 until the series accrues — they auto-activate.
//
// Only genuinely COHERENT single recurring series belong here — not heterogeneous
// market-KIND families (e.g. "tournament winner" spanning different tournaments) and
// not single-event multi-outcome families (e.g. one election's party markets), both of
// which collapse or read incoherently as a "series".
export const FAMILY_HUBS = [
  {
    familyKey: 'boi-rate-decision-v1',
    categoryKey: 'economy',
    title: 'החלטות ריבית בנק ישראל',
    description:
      'כל החלטות הריבית של בנק ישראל — המועד הפעיל, המועדים הקרובים וההחלטות שכבר הוכרעו, עם הסתברות שוק לכל תרחיש.',
    cadenceLabel: 'כ-8 פעמים בשנה',
    intro:
      'בנק ישראל מתכנס מספר פעמים בשנה כדי לקבוע את הריבית במשק — החלטה שנוגעת למשכנתאות, לחיסכון ולשקל. לקראת כל מועד נפתח שוק תחזיות שבו הקהל מעריך את ההסתברות לכל תרחיש: העלאה, הורדה או הותרת הריבית ללא שינוי. כאן מרוכזים כל המועדים במקום אחד — השוק הפעיל כעת, המועדים הקרובים וההחלטות שכבר הוכרעו.',
  },
  {
    familyKey: 'energy-israel-fuel-95-official-price',
    categoryKey: 'energy',
    title: 'מחיר בנזין 95 בישראל',
    description:
      'עדכוני המחיר המרבי המפוקח של בנזין 95 בשירות עצמי — התחזית לעדכון הקרוב וההיסטוריה, דרך שוק תחזיות.',
    cadenceLabel: 'מדי חודש',
    intro:
      'מדי חודש מתעדכן המחיר המרבי של בנזין 95 בשירות עצמי — מחיר מפוקח שקובע משרד האנרגיה. לקראת כל עדכון נפתח שוק תחזיות על כיוון המחיר והטווח הצפוי. כאן מרוכזים כל החודשים במקום אחד — העדכון הפעיל וההיסטוריה.',
  },
];

const BY_KEY = new Map(FAMILY_HUBS.map((family) => [family.familyKey, family]));

export function getFamilyHub(familyKey) {
  return BY_KEY.get(String(familyKey || '').trim()) || null;
}

export function familyHubPath(familyKey) {
  return `/series/${encodeURIComponent(familyKey)}`;
}
