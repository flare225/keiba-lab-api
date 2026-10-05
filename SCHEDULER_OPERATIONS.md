# Collection operations — v3.7.2

The hourly scheduler persists each run in `lab_collection_runs`, including start/end times, trigger kind, card/runner counts, missing cards, source errors and per-date results. Duplicate delivery of the same scheduled event does not repeat ingestion.

- `GET /v1/lab/scheduler-status?limit=10`: inspect recent runs and the most recent real cron execution. A manual run never counts as cron evidence. The endpoint marks the cron overdue after 90 minutes and running jobs stalled after 30 minutes.
- `POST /v1/lab/scheduler-run`: run the same collection pipeline manually and save a separate manual record. GET is refused. This writes staged programs/cards if available; it does not seal predictions.

Run status is one of `running`, `success`, `partial`, `cards-not-discovered`, `error`, or `no-work`. Missing cards are not proof that JRA has not published them. Fetch/parsing errors remain visible separately.

Program staging must succeed before card collection begins. The rotation, eight-card batch limit and source timeouts from v3.7.1 are retained. Existing audit and prospective LOCK gates remain active.

Validation: 36 passing tests, including actual SQLite persistence of run records, duplicate delivery, manual/cron separation, exception recording, stale heartbeat detection, staging failure and endpoint method/limit checks.

Production verification is recorded after deployment; pre-deployment unit tests do not establish that a cron has executed.
