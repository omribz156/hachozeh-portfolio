# Verification

Date: 2026-09-26
Scope: this curated portfolio candidate, not the live deployment.

## October 11 Security Refresh

The September results below are historical, not a claim about today's advisory feed.
Current local verification: 1,721 backend tests across 253 files; 23 frontend/security
helper tests; backend typecheck; Astro check (zero errors/warnings, existing hints)
and production build. Runtime npm audit reports zero vulnerabilities. The full audit
reports known development-only findings under two advisories; the named, dev-only
review expires November 10 and rejects new/production findings. See
`workspace/security/dependency-review.md`.

The chart scan-review hash was refreshed after reviewing its sole change: use of
the restricted server-side backend fetch wrapper. Chart markup and escaping are
unchanged. Database TLS tests use a synthetic public certificate with no private
key. This refresh contains no production connection material or private history.

The initial refresh `d516075` passed both hosted jobs in
[run 38087583644](https://github.com/omribz156/hachozeh-portfolio/actions/runs/38087583644).
The follow-up replaces TCP-only readiness with a bounded/coalesced query through
the actual database pool, without returning internal addresses or raw errors.
Its final hosted result is recorded in the repository Actions history.
Local Semgrep: 1,474 scanned files, no errors, the same seven individually reviewed
findings and no new findings. Staged patch secret scan: no leaks; this is not a new
whole-history scan. Synthetic public TLS certificate explicitly included in Git.

## GitHub Verification

The public snapshot commit `aa9f6a8738d9f0d7461b8c8490deb74df07d8f29` passed both
the `verify` and `static-security` jobs on GitHub's Ubuntu runner on 2026-09-26.
[Completed workflow run](https://github.com/omribz156/hachozeh-portfolio/actions/runs/36230410924).
The workflow installed dependencies, audited them, ran the backend and helper
tests, checked types, built Astro, and ran the Semgrep review gate. No deployment
or production database connection is part of the workflow.

## Local Checks

| Check | Result |
| --- | --- |
| Clean dependency installation | `npm ci --ignore-scripts` passed |
| Full dependency audit | Zero reported vulnerabilities |
| Backend unit suite | 246 files, 1,666 tests passed, private env loading disabled |
| Frontend helpers and scan-gate tests | 16 passed |
| SARIF parser regression suite | 18 passed |
| Backend typecheck | Passed |
| Astro check | Zero errors, zero warnings; 153 existing hints |
| Astro production build | Passed |
| Media integrity | 190 replacements decoded; no unchanged originals among them |
| Asset references | All 345 registry paths resolved |
| Browser injection regression | Chromium at 390px: no injected script/image nodes or payload execution |
| Semgrep 1.172.0 | 116 applicable rules over 1,458 source targets; no scan errors, seven reviewed audit findings |
| Gitleaks | 49 classified generic-key matches; no new finding locations |
| TruffleHog, verification disabled | Three negative-test credentialed URI fixtures; no confirmed secret leak |

## Static Scan Review

Rule sets: `p/security-audit`, `p/secrets`, `p/nodejs`, `p/react`, and
`p/github-actions`. The seven results are six intentional HTML insertion sites
for local chart markup and one negative assertion in a serialization test.
Chart builders now escape labels and constrain numeric interpolation. Unit tests
and a browser check exercised malicious label/numeric inputs.

`workspace/security/semgrep-reviewed.json` records exact findings, reasons, and
SHA-256 hashes of the producing code, consuming code, and regression tests.
The gate rejects new findings, changed reviewed code, scan errors, and an
unexpectedly small scan. No whole security rule was disabled.

Semgrep uses its standard ignore rules (245 files were skipped in this scan);
it is not semantic coverage of every file or language. Gitleaks and TruffleHog
scanned a separate export of the staged source, without node_modules, runtime
data, or the original Git history. Secret matches were reviewed, not blindly
suppressed: schema/market keys, explicit test values, and a provider's public
browser identifier are not private credentials. TruffleHog findings use reserved
example domains or a documentation-only IP address inside rejection tests.

## Limits

No production mutation, provider credential verification, database integration
test, fresh database boot, or full end-to-end UI pass was performed. Installation
lifecycle scripts were disabled. Build success is not production deployment
proof. Hosted checks are recorded separately above.

CodeQL was not executed: this copy has no project-wide open-source license or
established commercial entitlement. See GitHub's
[CodeQL terms](https://github.com/github/codeql-cli-binaries/blob/main/README.md).
The tested SARIF parser is retained as tooling, not represented as a CodeQL scan.

These checks support publication preparation; they are not a guarantee that the
software has no vulnerabilities or a legal opinion about all future uses.
