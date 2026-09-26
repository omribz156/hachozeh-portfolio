import { fetchFeed } from '../../../lib/discovery.js';
import { renderShareCardPng } from '../../../lib/share-card-image.js';
import { checkShareImageRateLimit, shareImageRateLimitResponse } from '../../../lib/share-image-rate-limit.js';

const PAGES = {
  trending: {
    feed: 'trending',
    eyebrow: 'שווקים מובילים',
    title: 'מה השוק חושב שיקרה עכשיו?',
    subtitle: 'השווקים הטרנדיים בהחוזה, עם מחירים חיים והסתברויות שמתעדכנות לפי פעילות המשתמשים.',
    tone: 'green',
  },
  'breaking-markets': {
    feed: 'breaking',
    eyebrow: 'שווקים מתפרצים',
    title: 'השווקים שזזו הכי הרבה היום',
    subtitle: 'מעקב מהיר אחרי תנועות חדות, שינויי הסתברות ושווקים שהקהל התחיל לתמחר מחדש.',
    tone: 'amber',
  },
  'closing-markets': {
    feed: 'closing',
    eyebrow: 'נסגר בקרוב',
    title: 'שווקים לפני סגירה',
    subtitle: 'שווקים פתוחים שנשארו להם פחות מ-24 שעות, מסודרים לפי הדדליין הקרוב ביותר.',
    tone: 'amber',
  },
  help: {
    feed: null,
    eyebrow: 'מרכז עזרה',
    title: 'איך עובדים שוקי התחזיות של החוזה',
    subtitle: 'מדריכים קצרים על V₪, מחירי שוק, חיזוי, הכרעה וחשבון המשתמש.',
    tone: 'blue',
  },
  terms: {
    feed: null,
    eyebrow: 'תנאי שימוש',
    title: 'כללי השימוש בהחוזה',
    subtitle: 'המסגרת של פלטפורמת תחזיות במטבע וירטואלי פנימי, בלי כסף אמיתי ובלי משיכה.',
    tone: 'green',
  },
  privacy: {
    feed: null,
    eyebrow: 'פרטיות',
    title: 'איך החוזה מתייחס למידע משתמשים',
    subtitle: 'מדיניות פרטיות בעברית: חשבון, פעילות משחק, אבטחה, עוגיות וזכויות משתמשים.',
    tone: 'blue',
  },
  cookies: {
    feed: null,
    eyebrow: 'עוגיות',
    title: 'עוגיות ואחסון מקומי בהחוזה',
    subtitle: 'שקיפות על עוגיות, אחסון מקומי, אנליטיקה וניטור — בלי פרסום ובלי הקלטת סשן.',
    tone: 'green',
  },
  accessibility: {
    feed: null,
    eyebrow: 'נגישות',
    title: 'הצהרת הנגישות של החוזה',
    subtitle: 'התחייבות לנגישות, עברית, RTL, ניווט מקלדת ושימוש נוח ככל האפשר.',
    tone: 'blue',
  },
  'graphs-and-accuracy': {
    feed: null,
    eyebrow: 'דיוק וגרפים',
    title: 'שקיפות על דיוק התחזיות',
    subtitle: 'כיול, הכרעות ומדדי דיוק של שוקי התחזיות בהחוזה, כשהנתונים זמינים.',
    tone: 'amber',
  },
  community: {
    feed: null,
    eyebrow: 'קהילת החוזה',
    title: 'התחזיות מקבלות קול',
    subtitle: 'דיונים, קריאות שוק ופוזיציות של קהילת החזאים — במקום אחד, בעברית.',
    tone: 'amber',
    rows: ['דיונים סביב שווקים חיים', 'פיד פעילות אמיתי', 'חזאים עם רקורד ציבורי'],
    stats: [
      { value: 'חי', label: 'פעילות שוק' },
      { value: 'V₪', label: 'מטבע וירטואלי' },
    ],
  },
};

function titles(items) {
  return (Array.isArray(items) ? items : []).map((item) => item?.title).filter(Boolean).slice(0, 3);
}

export async function GET({ params, clientAddress, request }) {
  const gate = checkShareImageRateLimit({ clientAddress, request });
  if (!gate.allowed) return shareImageRateLimitResponse(gate.retryAfterSec);

  const key = params.pageKey?.replace(/\.png$/i, '');
  const page = PAGES[key] || PAGES.trending;
  let items = [];
  if (page.feed) {
    try {
      const feed = await fetchFeed(page.feed);
      items = feed?.items || [];
    } catch {}
  }

  const png = await renderShareCardPng({
    ...page,
    rows: page.rows || titles(items),
    stats: page.stats || [
      { value: String(items.length || '—'), label: 'שווקים בפיד' },
      { value: 'V₪', label: 'מטבע וירטואלי' },
    ],
  });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  });
}
