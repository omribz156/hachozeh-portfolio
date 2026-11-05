# Development Dependency Review

## Static Showcase Recheck: November 5, 2026

The showcase candidate's full and production npm audits report zero advisories.
No new audit exception was added. The older review below is historical context.

Focused root overrides: glob 14.0.3 addresses GHSA-3g3m-2fjr-6pw4 and uses
patched minimatch 11; typescript-estree uses minimatch 11.0.4. Depcheck requires
the older callable CommonJS API, so it uses minimatch 6.2.3, outside the affected
7-through-10 range of GHSA-g3hv-75wg-m249. This is an explicit compatibility pin,
not a claim that minimatch 6 is the latest major. Do not replace all versions
with 11 globally: depcheck calls the module itself as a function.

Clean `npm ci`, the existing SSR build, static build, browser QA, and
`node --test workspace/security/dependency-compat.test.mjs` are verification gates.
Keep the lockfile: npm's workspace resolution can silently retain older
transitives after an override edit. Require both a clean build and the full audit;
an audit without a complete installed dependency graph is insufficient.

Sources: https://github.com/advisories/GHSA-3g3m-2fjr-6pw4 and
https://github.com/advisories/GHSA-g3hv-75wg-m249.

## Earlier Review

Reviewed October 11, 2026; expires November 10, 2026.

Production dependencies must have no advisories. The full audit also runs and
blocks new advisories, production occurrences, unknown packages and expired reviews.

One known development-toolchain issue remains: braces pattern recursion
(`GHSA-vfj7-8cjw-p6xm`). The PostCSS selector parsing issue was patched with
parser 7.1.6; its exception was removed. Current paths are the local Tailwind 3 and dependency-analysis
toolchain. They process repository-controlled patterns/styles, not public HTTP input.
Do not run the tooling on untrusted input. A malicious contribution could exhaust
a CI/build process; this is an accepted, bounded development risk, not a false positive.

There is no patched braces 3 release at review time. Automatic remediation proposes
a Tailwind major migration and dependency-tool changes, which need separate build
and visual verification. The narrow package/advisory/dev-only exception is explicit
in `check-dependency-audit.mjs`; it does not weaken the production audit.
