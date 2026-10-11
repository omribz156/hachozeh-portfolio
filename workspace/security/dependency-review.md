# Development Dependency Review

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
