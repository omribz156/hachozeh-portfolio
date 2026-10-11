# Maintenance Security Notes

Updated: 2026-10-11. This repository is a sanitized portfolio snapshot, not a
production deployment target. Provider coordinates remain placeholders.

- Restricted runtime role provisioning preserves the managed schema owner for
  separate migration work. Password output uses operator RSA-OAEP encryption;
  no private key or credential belongs in this repository. Existing roles fail
  closed rather than silently rotating credentials. Test on a synthetic database.
- Runtime grants allow table CRUD and sequence use, not DDL, TRUNCATE, TRIGGER,
  owner membership or migration-history writes. Future grants follow the owner.
- Security burst/recovery summaries use the existing audit table, bounded to one
  write per service/category/state per ten minutes per process. Cleanup caps these
  summaries at 30 days. Ordinary audit retention stays unchanged. This is not an
  independent immutable archive or complete request/SQL/object/admin history.
- Deployment helper follows backend/web handover with a gateway refresh and strict
  public readiness/session/populated-HTML checks. This operational guard is not a
  claim of zero downtime or a proven provider-network root cause. Dashboard and
  environment-triggered deployments require equivalent operator verification.
- Blueprint synchronization is separate from service auto-deploy: keep live auth
  enable/pause controls manually managed so synchronization cannot undo containment
  or an approved reopening. Instance-discovery routing can bypass a stale provider
  virtual route; validate both gateway-to-upstream and SSR-to-backend paths through
  actual instance replacement before claiming handover reliability.
- No new logging subscription. Live infrastructure proof and incident records stay
  in private operations documentation, never in this evaluation snapshot.
