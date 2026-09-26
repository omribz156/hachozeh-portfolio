create table if not exists feedback (
  id text primary key,
  user_id text not null,
  type text not null,
  title text,
  message text not null,
  reply_email text,
  screenshot_url text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_feedback_user
    foreign key (user_id) references users (id) on delete restrict,
  constraint chk_feedback_type
    check (type in ('idea', 'bug', 'feedback')),
  constraint chk_feedback_status
    check (status in ('new', 'triaged', 'closed')),
  constraint chk_feedback_title_length
    check (title is null or char_length(title) <= 120),
  constraint chk_feedback_message_length
    check (char_length(message) between 4 and 2000),
  constraint chk_feedback_reply_email_length
    check (reply_email is null or char_length(reply_email) <= 160),
  constraint chk_feedback_screenshot_url_length
    check (screenshot_url is null or char_length(screenshot_url) <= 240)
);

create index if not exists idx_feedback_status_created
  on feedback (status, created_at desc);

create index if not exists idx_feedback_user_created
  on feedback (user_id, created_at desc);
