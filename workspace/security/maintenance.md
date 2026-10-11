# Maintenance Notes

October 11, 2026. This repository is an independently tested portfolio snapshot,
not a production deployment controller.

- Test environments block the real watchdog notification sender before local
  credential lookup. Tests inject notification handlers and prove no shell network
  sender runs for simulated failures. Production alert semantics remain unchanged.
- Public anonymous HTML has a 60-second shared-cache lifetime and browser
  revalidation. Cookie-bearing, auth/query-bearing and non-public documents use
  private/no-store. Provider cache rules must respect origin response headers.
- The shared Tailwind toolchain anchors its patched PostCSS selector-parser 7.1.6
  override at the root. The removed selector-parser advisory exception must not be
  reintroduced to hide a regression. The remaining braces build-time advisory is
  documented in [dependency-review.md](dependency-review.md).
- Email authentication remains fail-closed without real deployment challenge keys
  and explicit enabling. This snapshot contains no production credentials or incident
  evidence; a build passing here is not proof that a live email was delivered.
