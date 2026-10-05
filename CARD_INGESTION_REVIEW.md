# KEIBA LABO ingestion check — 2026-10-05 JST

Live service: https://keiba-lab-api.sekai-no-bancyou.workers.dev/
Repository baseline: 3870800b4e5fcaa6f018ff6285bf835a0d9100ae
Entry point: src/index-v3.7.0.js (not src/index.js)

## Verified live state

- Service v3.7.0; D1 connected.
- 2026-10-10 through 2026-10-12: 72 staged programs, four graded programs, zero saved cards, zero runners.
- Prospective candidate scan: zero races and zero strict eligible candidates.
- These observations do not establish that JRA cards are unpublished.

## Confirmed defects

- v3.7.0 invokes /v1/jra/ingest once per program. That route ultimately reaches index.js, whose fullDayProbe reads today's date and has bootstrap seeds only for 2026-10-04. Request date, venue and race number are ignored.
- Batch success uses a generic ok flag and nonexistent runnerCount fields instead of the confirmed saved race.
- Audit sums header runner_count rather than actual jra_runners rows.
- Cron delegates to program staging and never invokes card ingestion.

## Proposed v3.7.1

- Discover actual JRA links, with bounded traversal. Never synthesize a race checksum.
- Persist only a source URL matching the requested date, venue and race number; reject redirect mismatches.
- Validate nonempty, contiguous and unique runner numbers; use the existing repair parser.
- Report per-batch results with cursor/nextCursor; at most eight card fetches per date.
- Row-level storage audit compares header counts with actual and distinct runner rows, detects invalid runners, orphan rows and program mismatches.
- One scheduled job owns staging then ingestion sequentially. Proposed hourly cron rotates three eight-card batches across up to three staged future dates, bounding source requests.

## Validation

Run `node --test tests/card-ingestion.test.mjs` (nine passing tests).
These tests use injected source/persistence adapters; they do not verify live JRA discovery or live D1 writes.

## Remaining before Saudi Arabia RC LOCK

- Deploy the reviewed patch and verify live source discovery after publication.
- Traverse cursor batches and require allCardsComplete in the row-level audit.
- Independently verify declared official runner count. The existing parser sets runner_count to the number of parsed horses; matching this with D1 rows alone cannot prove that all official horses were extracted.
- Existing parser derives frame numbers; verify against the official card before LOCK.
- Confirm the Saudi RC card and selected track assumption; run the existing prediction pipeline and prospective seal, then verify saved hash/time and idempotent response.
- Existing seal writes lock and hash rows separately. Atomic sealing and concurrency handling require a separate fix before calling this an end-to-end immutable audit.

No Saudi RC LOCK or production deployment was performed in this check. No result data was requested.
