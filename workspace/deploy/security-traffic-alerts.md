# Security Traffic Alerts

Updated: 2026-10-25

The web and backend use independent fixed 60-second windows per process.
These thresholds control notifications, not request admission or blocking.

| Signal | Threshold | Handling |
| --- | --- | --- |
| All requests | 600/minute | Burst alert |
| Missing paths (404) | 500/minute | Separate scan budget |
| Rate limits and server errors (429 + 5xx) | 100/minute combined | Burst alert, excluding 404 noise |
| Sensitive auth requests | 20/minute or 10 failures/minute | Unchanged stricter monitor |

Before this change, 100 combined 404/429/5xx responses triggered a notification.
Observed short 111-265-path scans repeatedly crossed that threshold without
indicating successful access. A missing path is not proof of safety or compromise;
auth and server-error investigation remain separate.

Telegram and retained audit summaries include the 404, 429 and 5xx breakdown.
The legacy `rejected` field remains their sum for rolling-deploy compatibility.
Auth failures are normalized to rejection signals, so the auth breakdown is a
failure count, not a literal HTTP-status histogram.

Reminders remain limited to once per ten minutes per service/category. Recovery
requires two quiet windows. Failed delivery is retried; pending incident counters
survive window rollover. Subthreshold scans generate neither burst nor recovery
messages. Existing bounded access logs remain enabled.

Deploy backend before web so the intake accepts and retains optional counters.
Legacy web signals remain accepted; partial, negative or inconsistent breakdowns
are rejected. No schema migration, new service, credentials or recurring cost.
Do not generate production floods to test notifications: use synthetic local
tests, deployed revision verification and passive production logs.

This does not suppress lifecycle/doctor alerts, change rate limiting, or fix
profile-read timeouts. Retained summaries are not complete historical request logs.
