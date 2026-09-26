# Public Handles

Updated: 2026-06-21
Status: current
Owner: backend / profile seams

Purpose:
- define public profile handle rules
- keep reserved words visible outside code
- prevent private auth identifiers from becoming public lookup keys

## Contract

- Public profile URLs use `/<handle>`.
- Legacy `/u/:userId`, `/u/:handle`, and `/api/social/users/:userKey` user-id lookup remain compatibility fallbacks only.
- Profile search matches only public `handle` and `displayName`.
- Email, identity provider ids, and private auth identifiers are not searchable public profile keys.

## Handle Rules

- Lowercase canonical value.
- Allowed characters: `a-z`, `0-9`, `_`, `.`.
- Length: `3-24`.
- Must start and end with a letter or digit.
- Leading `@` is accepted on write/check and normalized away.
- Duplicate handles return `409 handle_taken`.
- Invalid/reserved/malformed handles return `400 invalid_request`.
- Some reserved route names contain characters current handles do not allow; they stay listed so the route lock remains safe if handle rules expand later.

## Reserved Handles

Keep this list synced with:
- `systems/back/src/auth/current-user-profile-service.ts`
- `systems/back/migrations/045_user_public_handles.sql`
- `systems/back/migrations/046_user_public_handle_reserved_words.sql`
- `systems/back/migrations/047_extend_public_handle_reserved_words.sql`

Reserved:

```text
about
admin
admin-market-management
api
auth
breaking
breaking-markets
cookies
deposit
explore
fallback
feeds
graphs-and-accuracy
help
leaderboard
login
logout
market-detail
markets
me
new
new-markets
notifications
portfolio
privacy
profile
qanda
register
robots
search
settings
share
signup
sitemap
terms
topics
trending
u
wallet
```

## APIs

- `PATCH /api/me/profile` updates `handle`.
- `GET /api/me/profile/handle-availability?handle=<candidate>` checks availability for signed-in users.
- `GET /api/search?kind=profiles&q=<term>` searches public handles/display names only.
