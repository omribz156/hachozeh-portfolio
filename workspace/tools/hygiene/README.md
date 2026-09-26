# Repo Hygiene Tools

Status: current
Owner: project-wide / tooling
Updated: 2026-06-08

Purpose:
- keep whole-repo cleanup probes in one shared place
- make root `npm run hygiene:*` commands reusable by every session
- keep tool config out of product code directories

## Shape

- root `package.json`: shared command entrypoint and pinned dev tool versions
- `workspace/tools/hygiene/`: tool configs
- `workspace/reports/hygiene/`: generated reports and findings

## Commands

Run from repo root:

```bash
npm run hygiene:dead
npm run hygiene:dupes
npm run hygiene:cycles
npm run hygiene:deps
npm run hygiene:lint
npm run hygiene:deps:unused
npm run hygiene:updates
npm run hygiene:report
```

## Rule

These tools are probes first.

Do not auto-delete or auto-refactor from tool output. Classify findings into:
- obvious cleanup
- needs owner review
- intentional / leave alone
- tool false positive

Notes:
- `knip` intentionally skips `systems/design`; static HTML/design-lab references create too many false dead-file findings.
- `jscpd` still scans broad repo code, including legacy/front duplication, because copy evidence is useful during curation.
