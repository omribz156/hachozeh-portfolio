// Astro content collections config.
//
// First content-collection surface in the app: the Help Center (`מרכז עזרה`).
// One markdown file per help article under src/content/help/. Frontmatter is
// schema-validated here so a malformed article fails the build rather than
// rendering broken. Topic metadata + the hub featured list live in
// src/lib/help-content.js (plain data, derived counts).
//
// See: systems/design/guide/surfaces/help-center/README.md
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Keep in sync with HELP_TOPICS in lib/help-content.js. The 685a5e94 help rewrite
// shipped `portfolio` + `account-support` articles + topic config but left them out
// of this enum, which fails `astro build` platform-wide (InvalidContentEntryData).
const HELP_TOPIC_SLUGS = ['getting-started', 'markets', 'account-vshekel', 'portfolio', 'account-support', 'faq'] as const;

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    // The visible question/title (Hebrew).
    title: z.string(),
    // Which topic collection this article belongs to.
    topic: z.enum(HELP_TOPIC_SLUGS),
    // One-line summary shown as the article lede + topic-row context.
    lede: z.string(),
    // Last meaningful content update (drives the "עודכן · …" line).
    updatedDate: z.coerce.date(),
    // Order within its topic (also the displayed row number).
    order: z.number().default(0),
    // Space-separated Hebrew search keywords (feeds the build-time search index).
    keywords: z.string().default(''),
    // Answers touching the money model / gambling classification are seeded as
    // drafts and must clear legal-lane review (workspace/docs/legal/) before the
    // surface flips public. 'published' once reviewed.
    reviewStatus: z.enum(['legal-draft', 'draft', 'published']).default('published'),
  }),
});

export const collections = { help };
