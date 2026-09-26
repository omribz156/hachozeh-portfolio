create table if not exists user_verification_tier_purchases (
  user_id text not null,
  tier text not null,
  price_amount numeric(20, 6) not null,
  ledger_transaction_id text not null,
  purchased_at timestamptz not null default now(),
  constraint pk_user_verification_tier_purchases primary key (user_id, tier),
  constraint fk_user_verification_tier_purchases_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint fk_user_verification_tier_purchases_ledger
    foreign key (ledger_transaction_id) references ledger_transactions (id) on delete restrict,
  constraint chk_user_verification_tier_purchases_tier
    check (tier in ('gray', 'gold', 'diamond')),
  constraint chk_user_verification_tier_purchases_price_positive
    check (price_amount > 0)
);

create index if not exists idx_user_verification_tier_purchases_user_purchased
  on user_verification_tier_purchases (user_id, purchased_at desc);
