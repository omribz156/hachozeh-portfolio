import { useState, useEffect } from 'preact/hooks';
import { VShekelSymbol } from '../currency/VShekel.jsx';

// DOM structure, classes, data-* attrs, ARIA, and Hebrew text are preserved
// exactly so styles/pages/graphs-and-accuracy.css keys off them unchanged.
// SSR-generated chart HTML strings are injected via dangerouslySetInnerHTML —
// no client-side chart rendering.

const HEADER_OFFSET = 96;

const METHODOLOGY = [
  'כל המדדים מחושבים משווקים שהוכרעו בפועל, מתוך צילומי מחיר שנלקחו חודש, שבוע, יום, 12 ושעות 4 לפני מועד הסגירה.',
  'הדיוק משקף את התדירות שבה התוצאה המובילה בשוק תאמה את המציאות. מדד ברייר מודד את שגיאת הריבוע הממוצעת. הנתונים מתעדכנים אוטומטית עם כל הכרעה.',
];

const FAQ_ITEMS = [
  { q: 'מה המשמעות של "דיוק" כאן?', a: 'הדיוק משווה את ההסתברות שהשוק נתן לאירוע מול התוצאה בפועל. שוק שנתן 70% — אנו מצפים שאירועים כאלה יקרו ב-70% מהמקרים.' },
  { q: 'מהו מדד Brier?', a: 'פונקציית ניקוד לדיוק תחזיות הסתברותיות — ההפרש הריבועי הממוצע בין ההסתברות החזויה לתוצאה. ככל שנמוך יותר, התחזית טובה יותר.' },
  { q: 'למה הדיוק משתפר לקראת הסגירה?', a: 'ככל שמתקרבים לאירוע, מידע חדש זורם לשוק ואי-הוודאות יורדת. הסוחרים משקללים אותו במחיר, והתחזית מתחדדת.' },
  { q: 'מאיפה הנתונים?', a: 'ישירות ממנגנון השוק של "החוזה", ומתעדכנים בכל פעם ששוק נסגר ומוכרע.' },
];

const SECTIONS = [
  { id: 'stats', label: 'סטטיסטיקה' },
  { id: 'accuracy-time', label: 'דיוק טרם סגירה' },
  { id: 'prediction-reality', label: 'חיזוי מול מציאות' },
  { id: 'brier-volume', label: 'ברייר מול נפח' },
  { id: 'resolution', label: 'הרכב סגירה' },
  { id: 'methodology', label: 'מתודה' },
  { id: 'faq', label: 'שאלות ותשובות' },
];

// ── TOC sidebar ─────────────────────────────────────────────────────────────
function Toc({ activeId, onLinkClick }) {
  return (
    <aside class="ga-toc">
      <div class="ga-toc__inner">
        <div class="ga-eyebrow ga-toc__eyebrow">תוכן העניינים</div>
        <nav class="ga-toc__nav" aria-label="ניווט העמוד">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              class={`ga-toc__link${activeId === s.id ? ' is-on' : ''}`}
              href={`#${s.id}`}
              data-ga-toc={s.id}
              onClick={(e) => onLinkClick(e, s.id)}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

// ── Hero section ─────────────────────────────────────────────────────────────
function Hero({ status, isLive, headline, gaugeHtml }) {
  const heroLoading = status === 'loading' || status === 'error';
  const heroReady = status === 'ready' && Boolean(headline);

  return (
    <section id="stats" class="ga-panel ga-hero" style="scroll-margin-top:84px">
      <div class="ga-hero__copy">
        <div class="ga-eyebrow" style="color:var(--hz-brand)">{`דו״ח שקיפות${isLive ? ' · חי' : ''}`}</div>
        <h1 class="ga-hero__title">כמה דייקנו, יחד?</h1>
        <p class="ga-hero__sub">נתונים שקופים בזמן אמת על רמת הדיוק של חוכמת ההמונים ב״החוזה״.</p>
        <div class="ga-kpis">
          <div>
            {heroReady
              ? <div class="ga-kpi__value">{headline.markets}</div>
              : heroLoading
                ? <div class="ga-skel" style="width:96px;height:32px;position:relative"></div>
                : <div class="ga-kpi__value ga-kpi__value--empty">—</div>}
            <div class="ga-kpi__label">שווקים שהוכרעו</div>
          </div>
          <div class="ga-kpis__rule"></div>
          <div>
            {heroReady
              ? <div class="ga-kpi__value">{headline.volume}</div>
              : heroLoading
                ? <div class="ga-skel" style="width:96px;height:32px;position:relative"></div>
                : <div class="ga-kpi__value ga-kpi__value--empty">—</div>}
            <div class="ga-kpi__label" style="white-space:nowrap">נפח מסחר · <VShekelSymbol /></div>
          </div>
        </div>
      </div>
      {heroReady
        ? <div class="ga-gauge-wrap ga-gauge" dangerouslySetInnerHTML={{ __html: gaugeHtml }} />
        : heroLoading
          ? <div class="ga-skel" style="width:216px;height:216px;border-radius:50%;flex-shrink:0;position:relative"></div>
          : <div class="ga-gauge--empty"><span>—</span></div>}
    </section>
  );
}

// ── Horizon (4h / 12h) segmented toggle + charts ─────────────────────────────
function PredictionReality({ charts }) {
  const [horizon, setHorizon] = useState('4h');

  return (
    <section id="prediction-reality" class="ga-section">
      <div class="ga-head">
        <div>
          <h2 class="ga-head__title">חיזוי מול מציאות</h2>
          <p class="ga-head__desc">השוואה בין ההסתברות החזויה בשוק לבין תדירות ההתרחשות בפועל.</p>
        </div>
        <div class="ga-segmented" role="group" aria-label="טווח לפני סגירה">
          <button
            type="button"
            class={`ga-segmented__opt${horizon === '4h' ? ' is-on' : ''}`}
            data-ga-horizon-btn="4h"
            onClick={() => setHorizon('4h')}
          >4 שעות</button>
          <button
            type="button"
            class={`ga-segmented__opt${horizon === '12h' ? ' is-on' : ''}`}
            data-ga-horizon-btn="12h"
            onClick={() => setHorizon('12h')}
          >12 שעות</button>
        </div>
      </div>
      <div class="ga-panel">
        <div class="ga-legend">
          <span class="ga-legend__item"><span class="ga-legend__sw ga-legend__sw--expected"></span>צפי</span>
          <span class="ga-legend__item"><span class="ga-legend__sw ga-legend__sw--resolved"></span>בפועל</span>
        </div>
        <div
          data-ga-horizon="4h"
          hidden={horizon !== '4h'}
          dangerouslySetInnerHTML={{ __html: charts.prediction4h }}
        />
        <div
          data-ga-horizon="12h"
          hidden={horizon !== '12h'}
          dangerouslySetInnerHTML={{ __html: charts.prediction12h }}
        />
      </div>
    </section>
  );
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────
function Faq() {
  const [openIndex, setOpenIndex] = useState(0);

  function toggle(i) {
    // single-open accordion — matches the prototype
    setOpenIndex(openIndex === i ? -1 : i);
  }

  return (
    <section id="faq" class="ga-section">
      <div class="ga-head"><div><h2 class="ga-head__title">שאלות ותשובות</h2></div></div>
      <div class="ga-panel">
        <div class="ga-faq" data-ga-faq>
          {FAQ_ITEMS.map((f, i) => (
            <div
              key={i}
              class={`ga-faq__item${openIndex === i ? ' is-open' : ''}`}
              data-ga-faq-item
            >
              <button
                type="button"
                class="ga-faq__q"
                data-ga-faq-toggle
                aria-expanded={openIndex === i ? 'true' : 'false'}
                onClick={() => toggle(i)}
              >
                <span class="ga-faq__qtext">{f.q}</span>
                <span class="ga-faq__icon" aria-hidden="true">+</span>
              </button>
              <div class="ga-faq__a">{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Root island ───────────────────────────────────────────────────────────────
export default function GraphsAccuracy({
  status,
  isLive,
  headline,
  gaugeHtml,
  charts,
}) {
  // TOC spy — tracks activeId reactively, but also needs to expose a setter so
  // click-to-scroll can force the active link immediately.
  const sectionIds = SECTIONS.map((s) => s.id);
  const [activeId, setActiveId] = useState(sectionIds[0]);

  useEffect(() => {
    // rAF-coalesced scroll-spy — mirrors pages/help/[topic]/[article].astro's TOC
    // handler: raw scroll events can fire many times per frame, and each pass here
    // was doing one getBoundingClientRect() per section (7×) uncoalesced. The `raf`
    // guard collapses any burst of scroll/resize events into at most one
    // measure-and-set per animation frame.
    let raf = 0;
    function update() {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let current = sectionIds[0];
      for (let i = 0; i < sectionIds.length; i++) {
        const el = document.getElementById(sectionIds[i]);
        if (el && el.getBoundingClientRect().top <= line) current = sectionIds[i];
      }
      setActiveId(current);
    }
    function onScroll() {
      if (!raf) raf = requestAnimationFrame(update);
    }

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  function onTocLinkClick(e, id) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);
    const top = el.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  // error-state retry
  function onPageClick(e) {
    if (e.target.closest('[data-ga-retry]')) window.location.reload();
  }

  return (
    <div class="ga-page" data-ga-page data-ga-status={status} onClick={onPageClick}>
      <div class="ga-body">
        <Toc activeId={activeId} onLinkClick={onTocLinkClick} />

        <div class="ga-main">
          <Hero
            status={status}
            isLive={isLive}
            headline={headline}
            gaugeHtml={gaugeHtml}
          />

          {/* 01 accuracy before close */}
          <section id="accuracy-time" class="ga-section">
            <div class="ga-head">
              <div>
                <h2 class="ga-head__title">דיוק טרם סגירה</h2>
                <p class="ga-head__desc">עד כמה התחזיות ב״החוזה״ היו מדויקות בנקודות זמן שונות לפני מועד ההכרעה הסופי.</p>
              </div>
            </div>
            <div class="ga-panel">
              <div dangerouslySetInnerHTML={{ __html: charts.accuracy }} />
            </div>
          </section>

          {/* 02 prediction vs reality — horizon toggle */}
          <PredictionReality charts={charts} />

          {/* 03 brier */}
          <section id="brier-volume" class="ga-section">
            <div class="ga-head">
              <div>
                <h2 class="ga-head__title">מדד ברייר מול נפח מסחר</h2>
                <p class="ga-head__desc">ציון נמוך = דיוק גבוה. יותר נפח, שגיאה קטֵנה.</p>
              </div>
            </div>
            <div class="ga-panel">
              <div dangerouslySetInnerHTML={{ __html: charts.brier }} />
            </div>
          </section>

          {/* 04 resolution */}
          <section id="resolution" class="ga-section">
            <div class="ga-head">
              <div>
                <h2 class="ga-head__title">הרכב סגירה</h2>
                <p class="ga-head__desc">אחוז השווקים שהוכרעו בתוצאת "כן" לעומת "לא".</p>
              </div>
            </div>
            <div class="ga-panel">
              <div dangerouslySetInnerHTML={{ __html: charts.resolution }} />
            </div>
          </section>

          {/* 05 methodology */}
          <section id="methodology" class="ga-section">
            <div class="ga-head"><div><h2 class="ga-head__title">מתודה</h2></div></div>
            <div class="ga-panel">
              <div class="ga-methodology">
                {METHODOLOGY.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>
          </section>

          {/* 06 faq */}
          <Faq />
        </div>
      </div>
    </div>
  );
}
