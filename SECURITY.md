# Security

Report suspected vulnerabilities privately to **hachozeh@gmail.com**. Include the
affected source path, impact, and a minimal reproduction using synthetic local
data. Do not post credentials, personal data, or actionable live-system exploits
in public issues. No bug bounty or response-time guarantee is offered.

This repository is a portfolio source snapshot, not a deployment template for the
live service. Tests do not authorize probing production. Use an isolated local
database and no production credentials. Fixed OTP and demo configuration are for
loopback-only evaluation. Production requires independent configuration review.

The backend owns identity, sessions, authorization, ledger, and settlement.
New login/signup requires exactly `gmail.com`, including verified Google OAuth
email claims. Custom-domain Google accounts and `googlemail.com` are excluded.
Existing sessions are not revoked by this policy; Gmail aliases are not merged.
This domain restriction does not replace OTP/OAuth verification or abuse controls.
The auth smoke script requires an explicitly supplied owner-controlled Gmail address.
Frontend state is not an authorization boundary. Administrative lifecycle
commands require explicit authority and must never be run against a live service
as part of a source review.

Dependency audits, unit tests, and static scans reduce risk; they do not establish
the absence of vulnerabilities. See `SNAPSHOT.md` for the verified scope and limits.
