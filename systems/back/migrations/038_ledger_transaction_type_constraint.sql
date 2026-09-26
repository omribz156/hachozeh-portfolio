alter table ledger_transactions
  drop constraint if exists chk_ledger_transactions_type;

alter table ledger_transactions
  add constraint chk_ledger_transactions_type
    check (
      type in (
        'mint',
        'grant',
        'adjustment',
        'market_seed',
        'trade_buy',
        'trade_sell',
        'market_settlement',
        'treasury_sweep',
        'claim_payout',
        'void_refund',
        'treasury_top_up',
        'grant_reversal',
        'market_treasury_topup',
        'operator_cleanup_treasury_topup',
        'verification_tier_purchase'
      )
    );
