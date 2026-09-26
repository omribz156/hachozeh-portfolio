alter table oracle_case_reviews
  drop constraint if exists oracle_case_reviews_review_action_check;

alter table oracle_case_reviews
  add constraint oracle_case_reviews_review_action_check
  check (
    review_action in (
      'approve_close_condition',
      'approve_resolution',
      'reject_case',
      'request_more_evidence'
    )
  );
