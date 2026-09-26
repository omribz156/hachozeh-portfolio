// Help Center — topic config + path helpers + derived index builders.
//
// Topics are config (ordered, with display metadata). Articles are the
// `help` content collection (src/content/help/*.md). Article counts, the
// topic of each article, and the search index are all DERIVED from the
// collection here — never hardcoded in markup.
//
// See: systems/design/guide/surfaces/help-center/README.md

export const HELP_BASE = '/help';

export const HELP_CONTACT_EMAIL = 'hachozeh@gmail.com';

// Ordered topic rooms. `index` is the displayed mono marker (01…).
export const HELP_TOPICS = [
  {
    slug: 'getting-started',
    index: '01',
    title: 'התחלה',
    description: 'הרשמה, הצעדים הראשונים, ומה צריך לדעת לפני שמבצעים חיזוי ראשון.',
  },
  {
    slug: 'markets',
    index: '02',
    title: 'שווקים',
    description: 'איך נקבע מחיר, איך מבצעים חיזוי, ואיך השוק נסגר ונקבעת התוצאה.',
  },
  {
    slug: 'account-vshekel',
    index: '03',
    title: 'חשבון ו-V₪',
    description: 'מאיפה מגיע ה-V₪, איך הוא נצבר, וההפרדה בינו לבין כסף אמיתי.',
  },
  {
    slug: 'faq',
    index: '04',
    title: 'שאלות נפוצות',
    description: 'שאלות שחזרו עלינו: מה מותר ומה לא, ומה קורה כשהראיות אינן ברורות.',
  },
  {
    slug: 'portfolio',
    index: '05',
    title: 'תיק ודירוג',
    description: 'התיק שלך, הפוזיציות, הדיוק והרקורד, והפרופיל הציבורי.',
  },
  {
    slug: 'account-support',
    index: '06',
    title: 'חשבון ותמיכה',
    description: 'התחברות, הגדרות החשבון, ופתרון תקלות נפוצות.',
  },
];

// The 6 featured questions on the hub, in order. {topic, slug} → must match
// real article entries.
export const HELP_FEATURED = [
  { topic: 'getting-started', slug: 'what-is-hachozeh' },
  { topic: 'getting-started', slug: 'what-is-vshekel' },
  { topic: 'getting-started', slug: 'how-to-register' },
  { topic: 'markets', slug: 'how-markets-resolve' },
  { topic: 'faq', slug: 'why-not-gambling' },
  { topic: 'account-vshekel', slug: 'how-to-deposit' },
];

export function helpTopicPath(topicSlug) {
  return `${HELP_BASE}/${topicSlug}`;
}

export function helpArticlePath(topicSlug, articleSlug) {
  return `${HELP_BASE}/${topicSlug}/${articleSlug}`;
}

export function getTopic(topicSlug) {
  return HELP_TOPICS.find((t) => t.slug === topicSlug) || null;
}

// The collection entry `id` is the file path minus extension, e.g.
// "getting-started/what-is-hachozeh". The article slug is the basename.
export function articleSlugFromId(id) {
  const parts = String(id).split('/');
  return parts[parts.length - 1];
}

export function isPublishedHelpEntry(entry) {
  return entry?.data?.reviewStatus === 'published';
}

export function publishedHelpEntries(entries) {
  return entries.filter(isPublishedHelpEntry);
}

export function shouldPreviewHelpDrafts() {
  return process.env.HELP_DRAFT_PREVIEW === '1';
}

export function visibleHelpEntries(entries) {
  return shouldPreviewHelpDrafts()
    ? entries.filter((entry) => ['published', 'draft'].includes(entry?.data?.reviewStatus))
    : publishedHelpEntries(entries);
}

// Articles for one topic, sorted by `order`. `entries` = getCollection('help').
export function articlesForTopic(entries, topicSlug) {
  return entries
    .filter((e) => e.data.topic === topicSlug)
    .sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
}

export function topicArticleCount(entries, topicSlug) {
  return entries.filter((e) => e.data.topic === topicSlug).length;
}

// Build the flat search index the hub/topic/article search island consumes.
// Shape mirrors the design handoff: { url, q, topic, kw }.
export function buildSearchIndex(entries) {
  const topicTitle = (slug) => getTopic(slug)?.title || slug;
  return entries
    .slice()
    .sort((a, b) => {
      const t = (getTopic(a.data.topic)?.index || '').localeCompare(getTopic(b.data.topic)?.index || '');
      return t !== 0 ? t : (a.data.order || 0) - (b.data.order || 0);
    })
    .map((e) => ({
      url: helpArticlePath(e.data.topic, articleSlugFromId(e.id)),
      q: e.data.title,
      topic: topicTitle(e.data.topic),
      kw: e.data.keywords || '',
    }));
}
