# Collection operations — v3.7.2

The hourly scheduler persists each run in `lab_collection_runs`, including start/end times, trigger kind, card/runner counts, missing cards, source errors and per-date results. Duplicate delivery of the same scheduled event does not repeat ingestion.

- `GET /v1/lab/scheduler-status?limit=10`: inspect recent runs and the most recent real cron execution. A manual run never counts as cron evidence. The endpoint marks the cron overdue after 90 minutes and running jobs stalled after 30 minutes.
- `POST /v1/lab/scheduler-run`: run the same collection pipeline manually and save a separate manual record. GET is refused. This writes staged programs/cards if available; it does not seal predictions.

Run status is one of `running`, `success`, `partial`, `cards-not-discovered`, `error`, or `no-work`. Missing cards are not proof that JRA has not published them. Fetch/parsing errors remain visible separately.

Program staging must succeed before card collection begins. The rotation, eight-card batch limit and source timeouts from v3.7.1 are retained. Existing audit and prospective LOCK gates remain active.

Validation: 36 passing tests, including actual SQLite persistence of run records, duplicate delivery, manual/cron separation, exception recording, stale heartbeat detection, staging failure and endpoint method/limit checks.

Production verification (2026-10-05 JST): PR #2 merged as d1ca3b4dcd86412e1c213a27c7dfbfd073071ea2; the public deploy-check returns v3.7.2 and build persisted-collection-runs.

Manual production run manual:6f54d9ca-89fb-46bf-b7ee-f8df9434d252 started at 2026-10-05T05:57:10.431Z and completed with 16 attempted cards, 16 cards not discovered, zero saved cards/runners, zero failed cards and zero source errors. Its record correctly remains trigger_kind=manual.

The October 10–12 storage audit remains consistent: 72 programs, zero cards/runners and no anomalies. Saudi RC is not sealed.

A bounded observation spanning 15:00 JST did not find a scheduled invocation. The status endpoint still reports cronHeartbeat=not-observed; manual success is not proof of automatic execution. This does not establish a configuration fault: Cloudflare documents that Cron Trigger changes can take up to 15 minutes to propagate (https://developers.cloudflare.com/workers/configuration/cron-triggers/). The deployed runtime configuration and a subsequent real cron invocation still need verification.

No direct Cloudflare connection is available in this workspace; plugin discovery returned no Cloudflare matches. Do not claim the cron is operational until a scheduled run or the provider's execution record is observed.
