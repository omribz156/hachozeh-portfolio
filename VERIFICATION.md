# Local Verification

Date: 2026-09-26
Scope: this curated portfolio candidate, not the live deployment.

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
proof. GitHub Actions has not run for this candidate yet.

CodeQL was not executed: this copy has no project-wide open-source license or
established commercial entitlement. See GitHub's
[CodeQL terms](https://github.com/github/codeql-cli-binaries/blob/main/README.md).
The tested SARIF parser is retained as tooling, not represented as a CodeQL scan.

These checks support publication preparation; they are not a guarantee that the
software has no vulnerabilities or a legal opinion about all future uses.
