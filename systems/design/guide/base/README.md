# Frontend Base

Updated: 2026-05-20
Status: current
Owner: frontend lane

Purpose:
- translate the platform design constitution into frontend base laws
- keep CSS, typography, and AI-assisted design rules in one entrance
- prevent parallel styling systems from growing quietly

Read first:
- `workspace/docs/design.md`
- `systems/design/README.md`
- `systems/design/guide/README.md`

## Current Docs

- `css-base-contract.md`
  - native CSS source of truth
  - `--hz-*` token law
  - Tailwind boundary
  - migration guardrails
- `typography-and-print.md`
  - Arimo direction
  - Hebrew-first type tone
  - numeric/data readability
  - print/editorial influence
- `ai-assisted-design-method.md`
  - intent-to-mock-to-stage workflow
  - reference anatomy
  - critique rubric
  - anti-slop design loop
- `mobile-conventions.md`
  - viewport-fit / safe-area / dvh laws
  - global touch press feedback + 44px target floor
  - 16px input-zoom rule
  - trade-ticket bottom-sheet pattern + shared FX vocabulary

## Rule

Base docs are binding for frontend work unless `workspace/docs/design.md`
changes first.

If code and these docs disagree, stop and align them before adding another
parallel styling path.
