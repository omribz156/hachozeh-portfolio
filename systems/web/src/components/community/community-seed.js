// ── Front-first SEED for the community surface (ported from the design drop).
// This is placeholder content so the Preact port renders realistically BEFORE the
// backend exists. Every field here maps to a real entity in
// finish-community-integration.md — delete this file and feed real data when the
// threads/feed/follow endpoints land. ponytail: seed, not a data layer.
//
// ── COMPOSER DATA ─────────────────────────────────────────────────────────────
// ME, MARKETS, PORTFOLIO, ACHIEVEMENTS are front-only placeholders.
// ME        → real viewer identity from GET /auth/me
// PORTFOLIO → real open positions from GET /portfolio (keyed by market id)
// Both are wired in finish-community-integration.md.

export const ME = { name: 'אתה', tint: 't-amber', initial: 'א' };
export const MAX_POST = 280;      // discussion / take char cap (backend contract)
export const MAX_COMMENT = 1200;  // thread comment char cap (backend contract)

export const MARKETS = [
  { cat: 'מאקרו · ריבית',        q: 'בנק ישראל יוריד את הריבית עד ספטמבר 2026?',       short: 'בנק ישראל · ריבית',   p: 43, mv: { dir: 'up',   val: '▲ 6' } },
  { cat: 'ספורט · כדורסל',       q: 'מכבי תל אביב תעלה לפיינל פור היורוליג?',           short: 'מכבי ת״א · פיינל פור', p: 61, mv: { dir: 'up',   val: '▲ 4' } },
  { cat: 'פוליטיקה',             q: 'הבחירות יוקדמו לפני סוף 2026?',                    short: 'הקדמת בחירות 2026',   p: 38, mv: { dir: 'down', val: '▼ 3' } },
  { cat: 'תרבות · יורוויזיון',   q: 'ישראל תסיים בעשירייה הראשונה ביורוויזיון 2027?',  short: 'ישראל בעשירייה',      p: 57, mv: { dir: 'down', val: '▼ 4' } },
  { cat: 'מאקרו · אינפלציה',     q: 'מדד המחירים יעלה מעל 0.4% במאי?',                  short: 'מדד מאי מעל 0.4%',    p: 64, mv: { dir: 'up',   val: '▲ 2' } },
  { cat: 'מזג אוויר',            q: 'אוגוסט 2026 יהיה החם ביותר שנמדד בתל אביב?',       short: 'אוגוסט הכי חם',       p: 31, mv: { dir: 'flat', val: '—'   } },
];

// viewer's open positions — keyed by MARKETS index (front-only; real data → GET /portfolio)
export const PORTFOLIO = {
  0: { side: 'buy',  amount: 1200, entry: 37, pnl: 0    },
  2: { side: 'sell', amount: 650,  entry: 44, pnl: -430  },
  4: { side: 'buy',  amount: 900,  entry: 52, pnl: 1210  },
};

export const ACHIEVEMENTS = [
  { label: 'רצף 30 יום',         sub: 'שמרת על רצף של 30 יום בקהילה',               icon: 'local_fire_department' },
  { label: 'חוזה בכיר · מאקרו', sub: 'עלית לדרגת חוזה בכיר בקטגוריית מאקרו',       icon: 'workspace_premium'     },
  { label: 'דיוק 80%+',          sub: 'עברת 80% דיוק על 20 שווקים שהוכרעו',         icon: 'crisis_alert'          },
  { label: '10 הכרעות ברצף',     sub: 'בנית רצף של 10 הכרעות נכונות',               icon: 'check_circle'          },
];
//
// Take/comment bodies are segment arrays: plain strings render as text, {s,t}
// renders as a colored side-mention (כן/לא). Keeps the design's inline highlight
// without dangerouslySetInnerHTML.

export const TOPICS = ['הכל', 'פוליטיקה', 'מאקרו', 'ספורט', 'תרבות', 'מזג אוויר'];

export const FEATURED = {
  topic: 'מאקרו', cat: 'מאקרו · ריבית', prob: 43, mv: { dir: 'up', val: '6 השבוע' },
  threadId: 'rate-cut-sep',
  quote: ['המדד מצביע על האטה בליבה, אבל השוק מתמחר רק ', { em: '43%' }, ' להורדה עד ספטמבר. זו, לדעתי, הטעות הזולה של הרבעון.'],
  author: { name: 'איתי קפלן', tint: 't-violet', initial: 'א', sub: 'מומחה מאקרו · לפני 22 ד׳' },
  likes: 112, liked: true, comments: 28,
  stack: [{ t: 't-mint', i: 'ד' }, { t: 't-info', i: 'נ' }, { t: 't-rose', i: 'ש' }, { t: 't-amber', i: 'ע' }],
};

export const DISCUSSIONS = [
  {
    id: 'maccabi-final-four', topic: 'ספורט', cat: 'ספורט · כדורסל',
    market: { short: 'מכבי ת״א · פיינל פור', pp: 61, mv: { dir: 'up', val: '▲4' } },
    title: 'ההגנה של מכבי מספיק עמוקה לסדרה מול ריאל?',
    take: ['הרוטציה הקצרה הדאיגה אותי כל העונה, אבל שלושת המשחקים האחרונים שינו לי את הדעת. החזקתי ', { s: 'buy', t: 'כן' }, ' מ־48% — נשאר.'],
    author: { name: 'גל פרידמן', tint: 't-info', initial: 'ג' }, time: 'לפני שעה',
    stack: [{ t: 't-mint', i: 'ד' }, { t: 't-violet', i: 'א' }, { t: 't-amber', i: 'ע' }], replies: 34,
  },
  {
    id: 'early-elections', topic: 'פוליטיקה', cat: 'פוליטיקה',
    market: { short: 'הקדמת בחירות 2026', pp: 38, mv: { dir: 'down', val: '▼3' } },
    title: 'למה השוק עדיין מתמחר הקדמת בחירות גבוה מדי?',
    take: ['הקואליציה שרדה שלושה תקציבים. בלי טריגר חיצוני אני לא רואה את זה קורה לפני סוף השנה — ירדתי ל', { s: 'sell', t: 'לא' }, ' ב־44%.'],
    author: { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified' }, time: 'לפני 3 ש׳',
    stack: [{ t: 't-info', i: 'נ' }, { t: 't-rose', i: 'ש' }, { t: 't-cyan', i: 'ר' }], replies: 52,
  },
  {
    id: 'eurovision-order', topic: 'תרבות', cat: 'תרבות · יורוויזיון',
    market: { short: 'ישראל בעשירייה', pp: 57, mv: { dir: 'down', val: '▼4' } },
    title: 'סדר הביצוע בגמר חשוב יותר ממה שחושבים',
    take: ['היסטורית, מי שמופיע בחצי השני של הגמר מקבל יתרון זיכרון אצל המצביעים. אם נצא מוקדם — ה־57% נראה לי נדיב. שורט קטן על ', { s: 'sell', t: 'לא' }, '.'],
    author: { name: 'שיר אזולאי', tint: 't-rose', initial: 'ש' }, time: 'לפני 5 ש׳',
    stack: [{ t: 't-violet', i: 'א' }, { t: 't-mint', i: 'ד' }], replies: 19,
  },
  {
    id: 'may-cpi-housing', topic: 'מאקרו', cat: 'מאקרו · אינפלציה',
    market: { short: 'מדד מאי מעל 0.4%', pp: 64, mv: { dir: 'up', val: '▲2' } },
    title: 'הדיור לבדו יכול להחזיק את המדד החודש',
    take: ['סעיף הדיור עוד לא הגיב לעליות שכר הדירה ברבעון הקודם. אני נשאר ', { s: 'buy', t: 'כן' }, ' — זה הסעיף שכולם ממעיטים בו.'],
    author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium' }, time: 'אתמול',
    stack: [{ t: 't-info', i: 'נ' }, { t: 't-amber', i: 'ע' }, { t: 't-violet', i: 'א' }], replies: 41,
  },
];

export const FEED = [
  {
    id: 'f1', kind: 'position', topic: 'מאקרו', author: { name: 'נועה ברנדס', tint: 't-info', initial: 'נ', seal: 'verified' }, time: 'לפני 4 ד׳',
    verb: ['פתחה פוזיציה · ', { s: 'buy', t: 'קנייה · כן' }, ' ב־', { b: '1,200 V₪' }], glyph: 'buy', glyphIcon: 'trending_up',
    market: { cat: 'מאקרו · ריבית', title: 'בנק ישראל יוריד את הריבית עד ספטמבר 2026?', prob: 43, mv: { dir: 'up', val: '▲ 6' }, spark: true },
    likes: 24, comments: 7, follow: true,
  },
  {
    id: 'f2', kind: 'take', topic: 'מאקרו', author: { name: 'איתי קפלן', tint: 't-violet', initial: 'א' }, time: 'לפני 22 ד׳',
    verb: ['כתב קריאה על'], glyph: 'take', glyphIcon: 'format_quote',
    body: ['המדד האחרון מצביע על האטה ברורה בליבה. השוק מתמחר עדיין רק 43% להורדה, אבל אם יוני יחזור על מאי — זו תהיה הטעות הזולה של הרבעון. החזקתי ', { mention: 'כן' }, ' ואני מגדיל.'],
    market: { cat: 'מאקרו · ריבית', title: 'בנק ישראל יוריד את הריבית עד ספטמבר 2026?', prob: 43, mv: { dir: 'up', val: '▲ 6' } },
    reply: { tint: 't-mint', initial: 'ד', name: 'דנה לוי', text: 'לא בטוח שהליבה לבדה תזיז את הוועדה לפני אוגוסט. אני נשארת בצד השני בינתיים.' },
    likes: 112, liked: true, comments: 28, follow: true,
  },
  {
    id: 'f3', kind: 'result', topic: 'ספורט', author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium' }, time: 'לפני שעה',
    verb: ['הכריעה נכון — שוק נסגר'], glyph: 'win', glyphIcon: 'check',
    market: { cat: 'ספורט · כדורסל', title: 'מכבי תל אביב תעלה לפיינל פור היורוליג?', verdict: { kind: 'win', label: 'הכרעה: כן' }, entry: '38%', pnl: '+840' },
    streak: 5, likes: 203, comments: 41,
  },
  {
    id: 'f4', kind: 'milestone', topic: 'מאקרו', author: { name: 'אורי שגב', tint: 't-amber', initial: 'א' }, time: 'לפני שעתיים',
    mile: ['שמר על ', { b: 'רצף של 30 יום' }, ' בקהילה — ועלה לדרגת ', { b: 'חוזה בכיר' }, ' בקטגוריית מאקרו.'],
    likes: 64, comments: 9, follow: true,
  },
  {
    id: 'f5', kind: 'position', topic: 'תרבות', author: { name: 'שיר אזולאי', tint: 't-rose', initial: 'ש' }, time: 'לפני 3 ש׳',
    verb: ['פתחה פוזיציה · ', { s: 'sell', t: 'מכירה · לא' }, ' ב־', { b: '650 V₪' }], glyph: 'sell', glyphIcon: 'trending_down',
    market: { cat: 'תרבות · יורוויזיון', title: 'ישראל תסיים בעשירייה הראשונה ביורוויזיון 2027?', prob: 57, mv: { dir: 'down', val: '▼ 4' }, spark: true },
    likes: 18, comments: 5, follow: true,
  },
  {
    id: 'f6', kind: 'share', topic: 'מזג אוויר', author: { name: 'רון מזרחי', tint: 't-cyan', initial: 'ר' }, time: 'לפני 4 ש׳',
    verb: ['צירף שוק חדש למעקב — ', { b: 'שווה קריאה' }], glyph: 'share', glyphIcon: 'bookmark',
    market: { cat: 'חדש · מזג אוויר', title: 'אוגוסט 2026 יהיה החם ביותר שנמדד בתל אביב?', prob: 31, mv: { dir: 'flat', val: '—' }, chip: 'חדש' },
    likes: 9, comments: 2, follow: true,
  },
];

export const RAIL_NOW = [
  { topic: 'ריבית בנק ישראל', cnt: '128 דיונים' },
  { topic: 'פיינל פור יורוליג', cnt: '94' },
  { topic: 'הקדמת בחירות', cnt: '76' },
  { topic: 'יורוויזיון 2027', cnt: '51' },
  { topic: 'מדד מאי', cnt: '38' },
];

export const RAIL_PEOPLE = [
  { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified', cat: 'פוליטיקה', accuracy: 75 },
  { name: 'גל פרידמן', tint: 't-info', initial: 'ג', cat: 'ספורט', accuracy: 72 },
  { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium', cat: 'מאקרו', accuracy: 81 },
];

// ── THREAD detail seed (slice 3) ──────────────────────────────────────────────
// Keyed by discussion id so /community/t/:id resolves the home links. Two threads
// are fully fleshed from the design drop (rate-cut-sep, maccabi-final-four); the
// rest are compact (opening + two comments) so every link lands somewhere real.
// posChip = { side:'buy'|'sell', label }; body = array of paragraph segment-arrays;
// comment/reply body = single segment-array. Maps to the discussion/thread entity
// in finish-community-integration.md.
export const THREADS = {
  'rate-cut-sep': {
    id: 'rate-cut-sep', topic: 'מאקרו',
    market: {
      ctxCat: 'מאקרו · ריבית', heat: false,
      short: 'בנק ישראל · החלטת ריבית', pp: 43, mv: { dir: 'up', val: '▲6' },
      title: 'בנק ישראל יוריד את הריבית עד ספטמבר 2026?',
      prob: 43, chip: '▲ 6 השבוע',
      volume: '128K V₪', holders: '342', close: '30 ספט׳', closing: false,
    },
    opening: {
      q: 'המדד מצביע על האטה בליבה — למה השוק עדיין מתמחר רק 43% להורדה עד ספטמבר?',
      author: { name: 'איתי קפלן', tint: 't-violet', initial: 'א', sub: 'מומחה מאקרו · לפני 22 ד׳' },
      posChip: { side: 'buy', label: 'מחזיק · כן' },
      body: [
        ['המדד האחרון מצביע על האטה ברורה בליבה — שלושה חודשים ברציפות מתחת לתחזית הקונצנזוס. השוק מתמחר עדיין רק ', { b: '43%' }, ' להורדה עד ספטמבר, ואם יוני יחזור על מאי, זו תהיה הטעות הזולה של הרבעון.'],
        ['הטיעון הנגדי הקלאסי הוא ששכר הדירה עדיין לוחץ כלפי מעלה. נכון — אבל הסעיף הזה מפגר אחרי המגמה, והוועדה יודעת את זה. החזקתי ', { s: 'buy', t: 'כן' }, ' מ־37% ואני מגדיל בכל ירידה מתחת ל־45%.'],
      ],
      likes: 112, liked: true, comments: 28,
    },
    comments: [
      {
        id: 'rc-c1', author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium' },
        posChip: { side: 'sell', label: 'מחזיקה · לא' }, time: 'לפני 18 ד׳',
        body: ['לא בטוח שהליבה לבדה תזיז את הוועדה לפני אוגוסט. ההיסטוריה מראה שהם רוצים שני מדדים רצופים מתחת ל־2% לפני שינוי טון — וזה עוד לא קרה. נשארת ', { s: 'sell', t: 'לא' }, ' ב־44%.'],
        likes: 47, comments: 3,
        replies: [
          { id: 'rc-c1r1', author: { name: 'איתי קפלן', tint: 't-violet', initial: 'א' }, opTag: true, time: 'לפני 12 ד׳',
            body: ['בדיוק הנקודה — סעיף הדיור ייתן את המדד השני מתחת ל־2% כבר ביוני, לדעתי. ', { mention: '@דנה לוי' }, ' את מתמחרת אותו מהר מדי כלפי מעלה.'], likes: 14 },
          { id: 'rc-c1r2', author: { name: 'גל פרידמן', tint: 't-info', initial: 'ג' }, time: 'לפני 6 ד׳',
            body: ['השקל החזק הוא המשתנה שכולם מפספסים פה. הוא נותן לוועדה מרחב גם בלי האטה דרמטית בליבה.'], likes: 21 },
        ],
      },
      {
        id: 'rc-c2', author: { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified' },
        posChip: { side: 'buy', label: 'מחזיק · כן' }, time: 'לפני 9 ד׳',
        body: ['עם קפלן על זה. אם מסתכלים על העקום, השוק כבר זז 6 נקודות השבוע. ה־43% הוא תמונת מצב של אתמול, לא של מחר.'],
        likes: 33, comments: 1,
      },
      {
        id: 'rc-c3', author: { name: 'עדן ביטון', tint: 't-cyan', initial: 'ע' }, time: 'לפני 5 ד׳',
        body: ['שאלת הכרעה: השוק מתייחס גם להחלטת יולי או רק לספטמבר? אם יולי בפנים, ההסתברות המצרפית אמורה להיות גבוהה יותר ממה שאני רואה.'],
        likes: 8, comments: 1,
        replies: [
          { id: 'rc-c3r1', author: { name: 'נועה ברנדס', tint: 't-info', initial: 'נ', seal: 'verified' }, time: 'לפני 3 ד׳',
            body: ['הכרעה היא "עד תום ישיבת ספטמבר", כך שגם יולי נספר בפנים. כתוב במקור ההכרעה בעמוד השוק.'], likes: 11 },
        ],
      },
      {
        id: 'rc-c4', author: { name: 'רון מזרחי', tint: 't-rose', initial: 'ר' },
        posChip: { side: 'sell', label: 'מחזיק · לא' }, time: 'לפני 2 ד׳',
        body: ['כולם פה אופטימיים מדי. ועדה לא מורידה לפני שהיא בטוחה — ובמיניטס האחרונים הטון עוד היה זהיר. שורט קטן על ', { s: 'sell', t: 'לא' }, ', נראה מי צודק.'],
        likes: 5,
      },
    ],
    loadMore: 'עוד 24 תגובות',
    participants: [
      { name: 'איתי קפלן', tint: 't-violet', initial: 'א', cat: 'מאקרו', accuracy: 71 },
      { name: 'דנה לוי', tint: 't-mint', initial: 'ד', cat: 'מאקרו', accuracy: 82 },
      { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified', cat: 'פוליטיקה', accuracy: 75 },
    ],
  },

  'maccabi-final-four': {
    id: 'maccabi-final-four', topic: 'ספורט',
    market: {
      ctxCat: 'ספורט · כדורסל', heat: true,
      short: 'מכבי ת״א · פיינל פור', pp: 61, mv: { dir: 'up', val: '▲4' },
      title: 'מכבי תל אביב תעלה לפיינל פור היורוליג?',
      prob: 61, chip: '▲ 4 היום',
      volume: '410K V₪', holders: '1,120', close: 'בעוד יומיים', closing: true,
    },
    opening: {
      q: 'ההגנה של מכבי מספיק עמוקה לסדרה מול ריאל — או שאנחנו מתאהבים בשלושה משחקים טובים?',
      author: { name: 'גל פרידמן', tint: 't-info', initial: 'ג', sub: 'מומחה ספורט · לפני 40 ד׳' },
      posChip: { side: 'buy', label: 'מחזיק · כן' },
      body: [
        ['הרוטציה הקצרה הדאיגה אותי כל העונה. אבל שלושת המשחקים מול פנרבחצ׳ה שינו לי את הקריאה — ההגנה על הפיק-אנד-רול נראתה אחרת לגמרי, והם החזיקו קצב 40 דקות.'],
        ['נכנסתי ', { s: 'buy', t: 'כן' }, ' ב־48% ואני עדיין מחזיק ב־61%. השאלה האמיתית: זו קפיצת מדרגה אמיתית, או שלושה משחקים שמטעים אותנו? תשכנעו אותי שאני טועה.'],
      ],
      likes: 86, liked: true, comments: 87,
    },
    comments: [
      {
        id: 'mc-c1', author: { name: 'רון מזרחי', tint: 't-rose', initial: 'ר' },
        posChip: { side: 'sell', label: 'מחזיק · לא' }, time: 'לפני 31 ד׳',
        body: ['61% מנופח, סליחה. ריאל בבית בגיים החמישי, ומכבי לא לקחה שם משחק כבר שנתיים. שלושה משחקים מול פנר זה לא ראיה — זה מדגם קטן. שורט ', { s: 'sell', t: 'לא' }, ' בלי להתבלבל.'],
        likes: 19, comments: 5,
        replies: [
          { id: 'mc-c1r1', author: { name: 'גל פרידמן', tint: 't-info', initial: 'ג' }, opTag: true, time: 'לפני 28 ד׳',
            body: [{ mention: '@רון מזרחי' }, ' "שנתיים" זו סטטיסטיקה של סגל אחר לגמרי. תסתכל על דירוג ההגנה מינואר — הם עלו מ־12 ל־3 ביורוליג. זה לא מדגם, זה מגמה.'], likes: 31 },
          { id: 'mc-c1r2', author: { name: 'עדן ביטון', tint: 't-cyan', initial: 'ע' }, time: 'לפני 25 ד׳',
            body: ['גם הגיים החמישי לא אותו דבר השנה — קהל הבית של מכבי הזיז סדרות שלמות. ה־61% דווקא נראה לי שמרני.'], likes: 17 },
        ],
        showMore: 'הצג 3 תגובות נוספות',
      },
      {
        id: 'mc-c2', author: { name: 'שיר אזולאי', tint: 't-rose', initial: 'ש' },
        posChip: { side: 'buy', label: 'מחזיקה · כן' }, time: 'לפני 22 ד׳',
        body: ['מי שראה את הרבע האחרון מול פנר לא צריך מודלים. הם פשוט רצו יותר. נשארת ', { s: 'buy', t: 'כן' }, '.'],
        likes: 44, liked: true, comments: 2,
      },
      {
        id: 'mc-c3', author: { name: 'נועה ברנדס', tint: 't-info', initial: 'נ', seal: 'verified' }, time: 'לפני 16 ד׳',
        body: ['מישהו עם מידע על הברך של בלייקני? אם הוא מוגבל בדקות זה מזיז לי בערך 8 נקודות בהערכה — וזה ההבדל בין כן ללא בשבילי.'],
        likes: 12, comments: 1,
        replies: [
          { id: 'mc-c3r1', author: { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified' }, time: 'לפני 13 ד׳',
            body: ['התאמן מלא אתמול, בלי מגבלת דקות לפי הצוות. ', { mention: '@נועה ברנדס' }, ' אפשר להחזיר את ה־8 נקודות פנימה.'], likes: 23 },
        ],
      },
      {
        id: 'mc-c4', author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium' },
        posChip: { side: 'buy', label: 'מחזיקה · כן' }, time: 'לפני 8 ד׳',
        body: ['לשים את הרגש בצד רגע: השוק זז מ־48% ל־61% בשבוע. זה לא קהל מתלהב — זה תמחור מחדש אחרי הסדרה מול פנר, וההיסטוריה של הזזות בסדר גודל כזה אומרת שהן בדרך כלל צודקות. הוגן, אולי אפילו זול.'],
        likes: 58, comments: 4,
      },
    ],
    loadMore: 'עוד 83 תגובות',
    participants: [
      { name: 'גל פרידמן', tint: 't-info', initial: 'ג', cat: 'ספורט', accuracy: 72 },
      { name: 'רון מזרחי', tint: 't-rose', initial: 'ר', cat: 'ספורט', accuracy: 66 },
      { name: 'דנה לוי', tint: 't-mint', initial: 'ד', cat: 'מאקרו', accuracy: 82 },
    ],
  },

  'early-elections': {
    id: 'early-elections', topic: 'פוליטיקה',
    market: {
      ctxCat: 'פוליטיקה', heat: false,
      short: 'הקדמת בחירות 2026', pp: 38, mv: { dir: 'down', val: '▼3' },
      title: 'יוקדמו הבחירות בישראל לפני סוף 2026?',
      prob: 38, chip: '▼ 3 השבוע',
      volume: '96K V₪', holders: '510', close: '31 דצמ׳', closing: false,
    },
    opening: {
      q: 'למה השוק עדיין מתמחר הקדמת בחירות גבוה מדי?',
      author: { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified', sub: 'פרשן פוליטי · לפני 3 ש׳' },
      posChip: { side: 'sell', label: 'מחזיק · לא' },
      body: [
        ['הקואליציה שרדה שלושה תקציבים. בלי טריגר חיצוני אני לא רואה את זה קורה לפני סוף השנה — ירדתי ל', { s: 'sell', t: 'לא' }, ' ב־44%.'],
        ['כל אירוע מהסוג הזה דורש או משבר קואליציוני חריף או לחץ חיצוני, ושניהם לא על השולחן כרגע. ה־38% עדיין נדיב.'],
      ],
      likes: 64, comments: 52,
    },
    comments: [
      {
        id: 'ee-c1', author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium' },
        posChip: { side: 'buy', label: 'מחזיקה · כן' }, time: 'לפני 2 ש׳',
        body: ['לא הייתי מזלזל בלחץ התקציבי של 2027. מספיק סדק אחד בקואליציה והכל מתגלגל מהר. נשארת ', { s: 'buy', t: 'כן' }, ' בקטן.'],
        likes: 18, comments: 2,
      },
      {
        id: 'ee-c2', author: { name: 'עדן ביטון', tint: 't-cyan', initial: 'ע' }, time: 'לפני שעה',
        body: ['השאלה המעניינת היא מה נחשב "הקדמה" לצורך ההכרעה — פיזור יזום או גם נפילת ממשלה? זה משנה את ההסתברות מהותית.'],
        likes: 9,
      },
    ],
    loadMore: 'עוד 48 תגובות',
    participants: [
      { name: 'יואב נחום', tint: 't-amber', initial: 'י', seal: 'verified', cat: 'פוליטיקה', accuracy: 75 },
      { name: 'דנה לוי', tint: 't-mint', initial: 'ד', cat: 'מאקרו', accuracy: 82 },
    ],
  },

  'eurovision-order': {
    id: 'eurovision-order', topic: 'תרבות',
    market: {
      ctxCat: 'תרבות · יורוויזיון', heat: false,
      short: 'ישראל בעשירייה', pp: 57, mv: { dir: 'down', val: '▼4' },
      title: 'ישראל תסיים בעשירייה הראשונה ביורוויזיון 2027?',
      prob: 57, chip: '▼ 4 השבוע',
      volume: '54K V₪', holders: '288', close: '14 מאי', closing: false,
    },
    opening: {
      q: 'סדר הביצוע בגמר חשוב יותר ממה שחושבים',
      author: { name: 'שיר אזולאי', tint: 't-rose', initial: 'ש', sub: 'תרבות · לפני 5 ש׳' },
      posChip: { side: 'sell', label: 'מחזיקה · לא' },
      body: [
        ['היסטורית, מי שמופיע בחצי השני של הגמר מקבל יתרון זיכרון אצל המצביעים. אם נצא מוקדם — ה־57% נראה לי נדיב. שורט קטן על ', { s: 'sell', t: 'לא' }, '.'],
      ],
      likes: 29, comments: 19,
    },
    comments: [
      {
        id: 'ev-c1', author: { name: 'רון מזרחי', tint: 't-cyan', initial: 'ר' }, time: 'לפני 4 ש׳',
        body: ['הניתוח של סדר ההופעה נכון בגדול, אבל השנה הסמי-פיינל מגריל מחדש — אז זה הימור על הגרלה, לא על איכות. אני בחוץ עד שיֵצא הסדר.'],
        likes: 14, comments: 1,
      },
      {
        id: 'ev-c2', author: { name: 'נועה ברנדס', tint: 't-info', initial: 'נ', seal: 'verified' },
        posChip: { side: 'buy', label: 'מחזיקה · כן' }, time: 'לפני 3 ש׳',
        body: ['השיר חזק והבמה מושקעת — גם מהחצי הראשון אפשר לעשות עשירייה. ה־57% הוגן בעיניי, מחזיקה ', { s: 'buy', t: 'כן' }, '.'],
        likes: 11,
      },
    ],
    loadMore: 'עוד 15 תגובות',
    participants: [
      { name: 'שיר אזולאי', tint: 't-rose', initial: 'ש', cat: 'תרבות', accuracy: 69 },
      { name: 'נועה ברנדס', tint: 't-info', initial: 'נ', seal: 'verified', cat: 'מאקרו', accuracy: 78 },
    ],
  },

  'may-cpi-housing': {
    id: 'may-cpi-housing', topic: 'מאקרו',
    market: {
      ctxCat: 'מאקרו · אינפלציה', heat: false,
      short: 'מדד מאי מעל 0.4%', pp: 64, mv: { dir: 'up', val: '▲2' },
      title: 'מדד המחירים לצרכן של מאי יעלה מעל 0.4%?',
      prob: 64, chip: '▲ 2 השבוע',
      volume: '88K V₪', holders: '301', close: '15 יוני', closing: true,
    },
    opening: {
      q: 'הדיור לבדו יכול להחזיק את המדד החודש',
      author: { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium', sub: 'מומחית מאקרו · אתמול' },
      posChip: { side: 'buy', label: 'מחזיקה · כן' },
      body: [
        ['סעיף הדיור עוד לא הגיב לעליות שכר הדירה ברבעון הקודם. אני נשארת ', { s: 'buy', t: 'כן' }, ' — זה הסעיף שכולם ממעיטים בו.'],
      ],
      likes: 41, comments: 41,
    },
    comments: [
      {
        id: 'mh-c1', author: { name: 'איתי קפלן', tint: 't-violet', initial: 'א' },
        posChip: { side: 'buy', label: 'מחזיק · כן' }, time: 'לפני 20 ש׳',
        body: ['מסכים. גם סעיף ההבראה והנופש עונתי כלפי מעלה במאי. ה־0.4% נראה לי רצפה, לא תקרה.'],
        likes: 22, comments: 1,
      },
      {
        id: 'mh-c2', author: { name: 'רון מזרחי', tint: 't-rose', initial: 'ר' },
        posChip: { side: 'sell', label: 'מחזיק · לא' }, time: 'לפני 14 ש׳',
        body: ['זהירות — מחירי ההלבשה וההנעלה נוטים למשוך למטה בעונה הזו, וזה קיזז מדדים דומים בעבר. שורט קטן ', { s: 'sell', t: 'לא' }, '.'],
        likes: 9,
      },
    ],
    loadMore: 'עוד 37 תגובות',
    participants: [
      { name: 'דנה לוי', tint: 't-mint', initial: 'ד', seal: 'workspace_premium', cat: 'מאקרו', accuracy: 82 },
      { name: 'איתי קפלן', tint: 't-violet', initial: 'א', cat: 'מאקרו', accuracy: 71 },
    ],
  },
};
