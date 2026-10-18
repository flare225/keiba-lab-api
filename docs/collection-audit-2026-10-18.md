# Collection-to-prediction audit, 2026-10-18

Goal: user marks and independent LABO marks must be persisted before the race, then compared with results. Next-week preparation targets Thursday provisional assessment and Friday confirmed-card updates. These deadlines are requirements, not verified accomplishments.

## Confirmed code findings

- PR154 changes live assessment to recent-three-start evidence. PR155 reuses stored three-start histories. Neither fixes the separate scheduler eligibility test.
- PR161's upcoming and main-race scheduler still selected only `storedRows === 0` and requested ten starts. Upcoming SQL considered a horse covered after one valid start. Thus one/two-start stored histories could be skipped even when the collector reported them due. This is a code-level gap; it does not establish the cause of all missing production records.
- Fix: live scheduling targets three starts, includes due horses with zero/one/two stored starts, and upcoming SQL counts fewer than three valid prior starts. The missing-coverage expression is materialized once instead of evaluated in both SELECT and WHERE. Existing collector receipts, short-career handling, gate, lease, and cooldown remain authoritative.
- Frozen experiment eligibility in learning-history-priority.js is unchanged. Collection coverage is not prediction readiness or learning credit.
- The earlier fixed one-in-four advance allocation is withdrawn from this patch: its capacity and deadline sufficiency were not established.
- Scheduled background completion is already awaited by index-v3.48.2.js. The earlier suspected unconditional waitUntil accounting leak is not established; do not add a duplicate completion wrapper based on that hypothesis.

## Known operational evidence (earlier reads; not current queries)

- Oct18 quota rejection prevents current production readback. No additional production DB reads were made for this audit.
- Fuji S user final revision6 and Shuka final revision1 had verified explicit pre-race locks. Do not modify them.
- Shuka workout feed was unconfigured with zero rows. An ingestion endpoint is not a configured collection source.
- Today missing histories, official result details, independent LABO prediction snapshots and learning readiness are distinct states. Test success is not evidence that any missing production record has been saved.

## External implementations reviewed

- https://github.com/mervees/Horse-Racing-Analytics : prior-only features, chronological evaluation, independent baseline comparison and explicit synthetic-data limitations. These are review principles, not copied performance claims or newly deployed LABO behavior.
- https://github.com/kenwatabro/keiba-prediction-jvn : examined as a public implementation reference; no JRA-VAN subscription/feed or trained model is introduced by this patch.

## Remaining work

- Quantify next-week horses and available collection capacity after quota recovery, without repetitive status scans; allocate preparation and result-comparison work based on that evidence.
- Trace independent LABO snapshot persistence separately from user marks and frozen validation capture; verify actual records when DB access is available.
- Identify account-wide read costs from measured query metadata; scheduled meter explicitly excludes manual/user traffic. Do not claim a measured saving from SQL structure alone.
- Verify production deployment independently of DB, then perform one bounded DB readback after access is restored. Never fabricate past pre-race snapshots.

## Follow-up: prediction preparation boundary

The existing prelock-build called legacy /v1/lab/history-ingest (limit5) before scoring, regardless of stored collection progress, and invoked all later stages even after an earlier failure. It is distinct from the shared one-horse history-collection-batch path. Preparation now checks stored prior history only (two read queries, at most three valid prior starts counted per horse), reports missing horses, and stops all dependent stages on a failure or exception. It never starts history collection. Existing feature audit and immutable seal gates remain in place; thin career histories are reported rather than invented. This does not enable an automatic seal or assert production snapshot availability.

## Follow-up: publication acquisition root-path mismatch

Confirmed by tracing the active hourly wrapper into fast-rotation-v3.8.1.js: it called meeting-prep for eight dates and up to two eight-card ingestion batches outside lab_history_collection_budget. The three-minute profile/card collectors use that shared lease, but this hourly branch did not. Local reproduction exercises the actual hourly function with a blocked shared gate; the replacement performs zero source calls. A one-page 403/429/503 now advances the same shared gate by one hour and stops the delivery. This establishes an independent unbounded source path, not the numerical cause of account-wide D1 usage.

The replacement stages one calendar day per delivery, records a per-day receipt and rotates the next eight dates with a twelve-hour recheck interval. Card collection uses the existing shared one-page discovery path. Its scheduled plan now includes the coming week, retains date in race identity, skips per-card discovery receipts that are not due, and checks the shared gate before scanning program/history coverage. Global cooldown is never bypassed by selecting a different race.

The deleted tests asserted that hourly delivery swept 72/108 cards via multi-page batches; that behavior conflicts with the bounded shared-source policy. Replacement tests check eight distinct calendar days, one source call per delivery, shared stop/lease enforcement, future-date identity and deferred-card progress. No current production data has been read to claim that next-week cards or histories are complete. Friday deadline capacity and production end-to-end data completion remain open.
