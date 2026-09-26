# Help Center Surface Contract

Updated: 2026-06-09
Status: current
Owner: frontend / help-center surface

Purpose:
- define the visual and interaction direction for the Help Center (`מרכז עזרה`)
- give future frontend + content work one clear design target
- keep help content honest, legible, and free of gambling/marketing energy

Authority:
- this is a surface contract under `workspace/docs/design.md`
- binding for help-center work unless the design constitution changes
- it does not override platform-wide typography, tone, or anti-slop rules

Design source:
- the settled design lab bundle: `systems/design/design_handoff_help_center/`
  (hub / topic / article HTML + `help.css` + `help-search.js`). That bundle is
  the *spec*; the shipped surface is the Astro rebuild in `systems/web/`.

Implementation (shipped 2026-06-09):
- routes: `/help` (hub), `/help/[topic]` (collection), `/help/[topic]/[article]`
- content: Astro content collection `src/content/help/*.md` (one file per article)
  + topic config in `src/lib/help-content.js`
- styles: `systems/web/src/styles/pages/help-center.css` (classes namespaced `hz-help-*`)
- search + TOC scroll-spy: page islands
- retired: the legacy `/qanda` Q&A surface (301 → `/help`)

## Role In The Product

The Help Center is where a user goes to *understand the platform itself* — not a
market, not their book, but the rules of the game: what Hachozeh is, what V₪ is,
how a market resolves, and why this is not gambling.

It is the calmest, most editorial surface on the platform. Where market-detail is
theater and portfolio is the analyst's study, the Help Center is the **reference
shelf** — a place you arrive at with a question and leave with an answer.

## Core User Jobs

1. **Search** — "I have a specific question, take me to the answer."
2. **Jump to a common question** — the 6 featured questions on the hub.
3. **Browse by topic** — when the question isn't yet formed.
4. **Read an article** — prose with an on-page table of contents.

A user should reach any answer in at most two clicks from the hub, or one search.

## The Three Views

### 1. Hub (`/help`)
Front door. Vertical centered column (`max-width: 1180px`):
- hero — breadcrumb, info-blue eyebrow `מדריך לפלטפורמה`, H1, lede, **search**
- `התחילו כאן` — one big card with the 6 featured questions in a 2-col grid
  (vertical + row hairlines; collapses to 1-col < 700px)
- `נושאים` — 6 topic cards (2-col), each with mono num + derived article count,
  H3, description, and a `card-foot` with a growing amber inline-start bar on hover
- contact line — `שאלה שלא נענתה?` + mailto

### 2. Topic / Collection (`/help/[topic]`)
Slim full-width search band → collection header (spans the container, right-aligned
with the article list: breadcrumb, amber mono marker `· 01 — התחלה`, H1, description,
derived article count) → an
article-list card of numbered rows (mono num, title, chevron; hover → amber).

### 3. Article (`/help/[topic]/[article]`)
Slim search band → 2-col grid (reading column `1fr` + TOC rail `15rem`, collapses
to 1-col < 920px with the TOC reflowing above as a hairline-separated row).
- reading column (`max-width: 44rem`): breadcrumb, H1, lede, mono `עודכן · …` date
  above a hairline, then `.hz-help-prose` (body / h2 / ul / strong / a / blockquote)
- TOC rail: sticky, built from the article's `h2` headings, driven by scroll-spy
  (active item gets an amber inline-start border)
- article foot: `השאלה לא נענתה?` + mailto

## Content Model

Each **article** is one markdown file with frontmatter:
`title`, `topic` (slug), `lede`, `updatedDate`, `order`, `keywords`,
optional `reviewStatus` (`legal-draft` for answers awaiting legal-lane review).
Body is plain Markdown → `.hz-help-prose`; `h2`s feed the TOC.

Each **topic** is config (`src/lib/help-content.js`): `slug`, `index` (01…),
`title`, `description`. Article counts are **derived** from the collection, never
hardcoded. The hub's featured list is an ordered `{topic, slug}` array.

Topics: `getting-started` (התחלה), `markets` (שווקים), `account-vshekel`
(חשבון ו-V₪), `faq` (שאלות נפוצות), `portfolio` (תיק ודירוג), `account-support`
(חשבון ותמיכה).

## Visual Character

- premium dark-native, warm-neutral ink (`--hz-bg`, never pure black)
- amber `--hz-brand` is the only accent that "walks in the room" — used on hover
  states, the active TOC border, the topic-card edge bar, and prose links
- info-blue `--hz-info` for eyebrows + search-result topic tags only
- IBM Plex Mono for breadcrumbs, markers, counts, dates, and the `.num` figure span
- display headings: Noto Sans Hebrew 800 *if loaded*, else Arimo 800 (see below)
- generous spacing; hairlines (`--hz-border-faint`) do the structural work, not boxes

## Typography Note (font decision, 2026-06-09)

The design mock specifies **Noto Sans Hebrew 800** for display headings (Arimo
can't go heavier than 700 cleanly). The platform font lock is **Arimo + IBM Plex
Mono** (trending handoff, 2026-05-12). The shipped build keeps headings on the
`"Noto Sans Hebrew", var(--hz-font-ui)` fallback chain **without loading Noto** —
so headings render in Arimo 800, consistent with the rest of the platform. If we
decide the heavier Noto display face is worth a third font family, add it to
`Layout.astro`'s font load and it flows here automatically. Flagged, not silently
decided.

## Legal Framing Implication

The Help Center is the surface most likely to be read by a regulator, a skeptical
journalist, or a cautious new user. Copy must:
- avoid `הימור`, `הימורים`, `cash out`, "win money", casino/sportsbook energy
- frame V₪ honestly: a closed, non-withdrawable internal unit of account
- present "why this is not gambling" as a sober structural explanation, not a
  defensive disclaimer

Answers touching the money model or gambling classification carry
`reviewStatus: legal-draft` and must be reviewed against `workspace/docs/legal/`
and the locked Path A decision (V₪ unsellable, cosmetics-only) before they go
public.

## Indexing Policy

**SHIPPED INDEXED (~2026-07).** The old "whole surface ships noindex until legal
review" clause is RETIRED — do not repeat it. The help surface is `index, follow`
and in the sitemap. The gate is now **per-article, not whole-surface**:

- `reviewStatus: published` → `index, follow` + emitted in `sitemaps/static.xml`.
- any other status (`draft`, `legal-draft`) → `noindex, nofollow` + excluded from
  the sitemap, until that answer is reviewed and flipped to `published`.

Enforced by the `reviewStatus === 'published'` ternary in
`systems/web/src/pages/help/[topic]/[article].astro`. Hub + topic pages are always
`index, follow`. (As of 2026-07: 19 articles published/indexed, 1 draft noindex.)

## Still Open

- real first-draft copy for the 12 non-overview articles (seeded as short drafts;
  legal-sensitive ones flagged `legal-draft`)
- whether the hub search should hit a real backend index once content grows past
  the static array (today it's a build-time index injected into the page)
- whether `מטבע וירטואלי V₪` / `תקנון` / `פרטיות` shell links become deep article
  links or stay greyed stubs (currently greyed per owner decision)
