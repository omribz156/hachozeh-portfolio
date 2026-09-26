# Market Detail Presentation Playbook

Updated: 2026-06-24
Status: current
Owner: frontend / market-detail surface

Purpose:
- define how market detail consumes Seer-shaped market presentation
- keep Front from parsing backend prose into user-facing trust copy
- preserve market-detail hierarchy while showing source/rule/timeline clearly

Source of wording truth:
- `workspace/docs/agents/seer/market-presentation-shaping-v1.md`
- `systems/design/general-context/voice.md`

This doc is the consumer contract.
Seer shapes the copy.
Front displays it.

## Ownership Boundary

Seer owns:
- market naming
- visible measurement copy
- visible resolution rule copy
- source label/url choice
- outcome labels and outcome resolution paths
- delay/payout/ambiguity policy wording
- on-voice human copy quality

Front owns:
- where those fields appear
- hierarchy, wrapping, RTL behavior, and scanability
- source link placement
- legacy fallback behavior
- avoiding duplicate or contradictory text

Front should not:
- split long prose into new rule meanings when structured contract fields exist
- expose machine endpoints
- append generic market-structure filler when Seer supplied a rule
- turn adapter/source notes into user copy
- launder weak or machine-written market copy into prettier UI

## Preferred Data Mapping

When `snapshot.contract` exists, market detail should render:

| UI area | Preferred field | Legacy fallback |
| --- | --- | --- |
| headline | `market.title` or future `contract.displayTitle` | existing title |
| `מה נמדד` | `snapshot.contract.measurement` | first sentence from `trust.resolutionRules` |
| `איך מוכרע` | `snapshot.contract.resolutionRule` | remaining parsed rule sentences |
| `אם יש עיכוב` | `snapshot.contract.delayPolicy` | delay-like sentence from `trust.resolutionRules` |
| source link label | `snapshot.contract.resolutionSource.label` | `snapshot.trust.resolutionSource` |
| source link URL | `snapshot.contract.trustDisplayUrl` or `resolutionSource.url` | `snapshot.trust.sourceUrl` |
| outcome explanation | `snapshot.contract.outcomeMap[].resolutionPath` | generic outcome fallback |

`trust.resolutionRules` is legacy prose.
Use it only when structured contract fields are absent.

## Visible Source Rule

Source should be visible as a calm fact/link.
Source mechanics should not be visible as rule text.

Good:
- source side rail: `TradingView USD/ILS ↗`
- rule card: `כן אם שער הדולר/שקל הוא לפחות 2.82 ש"ח בסוף הזמן שנקבע.`

Bad:
- headline: `... לפי TradingView`
- rule card: `השוק מוכרע לפי Hachozeh snapshot...`
- rule card: `מקור מכונה: https://api...`

## Headline Display

Market question/title is the first product object.

Requirements:
- strong but readable
- Hebrew-first
- wraps gracefully
- no tiny source/vendor suffixes that make the title look like a scraped query
- no duplicate date/source metadata around the title

If the title includes backend/vendor mechanics, the market data is wrong.
Do not patch it visually in Front; send it back to Seer/lifecycle shaping.

If the title sounds generated, hypey, or padded, the market data is still wrong.
Front can truncate or wrap copy; it must not become the editor of record.

## Trust Card Display

Trust cards should answer:
- what is measured
- how it resolves
- what happens if source/result is delayed

They should not feel like:
- legal dump
- backend report
- source adapter receipt
- raw audit trail

Rules:
- prefer one concise paragraph per card
- no URLs in card body when source link exists in side rail
- no `Oracle`, `backend`, `machine`, `snapshot`, ids, or hashes in card body
- no `b=...`, `seed=...`, or proof/test metadata

## Family Presentation Notes

Live FX:
- title can be `יחס שקל/דולר ב-2 ביוני`
- source link can say `TradingView USD/ILS`
- trust cards should not mention snapshot capture

Weather:
- title can be a natural market question
- `מה נמדד` should name daily max/min and city/date
- station id/API endpoint stays hidden

Sports:
- title should name matchup and market type
- `איך מוכרע` should name official final result or 90-minute result
- game id/JSON endpoint stays hidden

BOI:
- binary and multi copy must not mix
- source link can be Bank of Israel
- rule should focus on rate decision outcome

Knesset/politics:
- rule should name official act/publication
- no internal proof/image-bucket text

## Fallback Behavior

Legacy market without `snapshot.contract`:
- use `trust.resolutionRules` parsing as today
- keep source side rail
- keep generic market-structure fallback only when no backend/Seer rules exist

Structured market with incomplete copy:
- prefer showing missing/quiet copy over inventing resolution logic
- file or surface the shaping defect to Seer/lifecycle

## Review Checklist

Before changing market-detail presentation:
- Does Front render structured contract fields first?
- Are source link and rule copy separate?
- Can the headline scan on mobile?
- Does the trust layer avoid backend terms?
- Are we hiding machine endpoints from user-facing cards?
- Are we preserving source trust without overloading the title?
- Is fallback clearly legacy-only?
