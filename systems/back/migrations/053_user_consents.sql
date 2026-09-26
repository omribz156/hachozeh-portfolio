-- Records user acceptance of legal documents (Terms of Use, Privacy Policy, 18+ eligibility).
-- One row per document per version, stamped at account creation by recordSignupConsent().
-- Per-document rows keep the record unbundled even though the signup UI bundles the click,
-- which is the stronger posture under Israel's consent-only privacy regime (Amendment 13) and
-- gives the Terms a real, timestamped, versioned acceptance record (enforceability).

create table if not exists user_consents (
  id text primary key,
  user_id text not null,
  document text not null,
  version text not null,
  source text not null default 'signup',
  accepted_at timestamptz not null default now(),
  constraint fk_user_consents_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_user_consents_document
    check (document in ('terms', 'privacy', 'age_18')),
  constraint chk_user_consents_source
    check (source in ('signup', 'reaccept'))
);

create unique index if not exists uq_user_consents_user_document_version
  on user_consents (user_id, document, version);

create index if not exists idx_user_consents_user_accepted
  on user_consents (user_id, accepted_at desc);
