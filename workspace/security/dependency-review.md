# Development Dependency Review

Reviewed October 11, 2026; expires November 10, 2026.

Production dependencies must have no advisories. The full audit also runs and
blocks new advisories, production occurrences, unknown packages and expired reviews.

Two known development-toolchain issues remain: braces pattern recursion
(`GHSA-vfj7-8cjw-p6xm`) and PostCSS selector parsing complexity
(`GHSA-rj75-hqrm-r3gf`). Current paths are the local Tailwind 3 and dependency-analysis
toolchain. They process repository-controlled patterns/styles, not public HTTP input.
Do not run the tooling on untrusted input. A malicious contribution could exhaust
a CI/build process; this is an accepted, bounded development risk, not a false positive.

There is no patched braces 3 release at review time. Automatic remediation proposes
a Tailwind major migration and dependency-tool changes, which need separate build
and visual verification. The narrow package/advisory/dev-only exception is explicit
in `check-dependency-audit.mjs`; it does not weaken the production audit.
