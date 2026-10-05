# KEIBA LABO Work handoff — v3.8.2 — 2026-10-05 JST

## Current main

- Repository: `flare225/keiba-lab-api`
- Main merge checkpoint: `145a7c98c840eebc776c972f1d53692445f5e36b`
- Worker entry: `src/index-v3.8.2.js`
- Cron config remains hourly: `0 * * * *`
- Production deployment of this exact main commit must still be verified externally; repository merge alone is not proof that Cloudflare is serving v3.8.2.

## Completed before official race cards publish

### v3.8.0 — target-scoped prelock readiness

- Added `/v1/lab/prelock-readiness`.
- Prospective Step 7 now requires an explicit `track` assumption at the outer gate; omitted track is rejected instead of silently defaulting to `良`.
- Saudi RC readiness is target-scoped and must not wait for unrelated 2026-10-12 cards.
- Existing card/evidence/outcome/immutable-seal guards remain in place.

### v3.8.1 — faster all-race publication sweep

- Replaced the redundant three-date rotation at the active wrapper with a deterministic five-phase sweep.
- Three dates × three 8-card slots = nine unique batches are covered as `2 + 2 + 2 + 2 + 1` over five hourly phases.
- Maximum hourly card-ingestion load remains two 8-card batches; the optimization removes duplicate work rather than increasing peak load.
- One or two available race dates still cover all three slots within three hours.
- Cron/manual collection run records are versioned as v3.8.1 by the active scheduler observability layer inherited by v3.8.2.

### v3.8.2 — prelock feature build + evidence-depth freeze

- Added `/v1/lab/prelock-build`.
- It builds pre-race history, track bias, base ranking, pace/style, neutral pace fill, provisional condition and workout overlay without writing a prospective seal.
- Added target-level core feature audit requiring complete card rows plus all-runner coverage for:
  - basic ability/results
  - recent performance/development
  - pace/style fit (observed or explicitly neutral-imputed)
  - integrated prelock snapshot
- `/v1/lab/prelock-readiness` is enriched with the core feature audit and thin-history warnings.
- A new prospective seal is refused when the core feature layer is incomplete; an already-existing immutable seal still bypasses this build gate so repeated calls remain idempotent.
- Step 7 immutable snapshots now freeze, per runner:
  - pre-race history row count
  - base model coverage percentage
  - base evidence confidence percentage
- Seal quality now includes evidence-depth counts (`zeroHistory`, `oneHistory`, `twoPlusHistory`, confidence coverage).
- Sparse two-year-old history does **not** mutate weights or scores. It is recorded for later validation so Saudi RC remains a clean holdout rather than a target-tuned model.

## Verified pre-existing safety baseline

Before v3.8.x, production verification had already established:

- A real published 2026-10-04 Tokyo 11R card saved 17/17 runners with no duplicates/invalid rows.
- Official source count/evidence and runner fingerprint checks passed.
- Past-race prospective seal requests were refused.
- Atomic two-row seal storage, SHA-256 verification, mutation/deletion rejection and card-change guards passed local SQLite tests.
- October 10–12 program layer contained 72 staged races; race-card layer was still 0/0 before publication.
- Saudi RC was not sealed.

## JRA publication timing that affects operations

This is a three-day meeting. Do not use weekend-wide `72/72 cards complete` as a Saudi RC seal prerequisite.

- Saudi RC target: 2026-10-10 Tokyo 11R, turf 1600m, scheduled 15:45 JST.
- JRA runner information: scheduled 2026-10-06.
- Official Saudi RC race card: scheduled 2026-10-08.
- 2026-10-12 cards are staggered later: Swan Stakes numbered card after 10:00 JST on 2026-10-10; other 10/12 numbered cards after 10:00 JST on 2026-10-11.

Therefore all-race accumulation and Saudi RC prospective validation are intentionally separate gates.

## Execution order after Saudi RC official card publication

1. Verify deployed API reports v3.8.2.
2. Verify a real scheduled Cron heartbeat; manual success is not Cron proof.
3. Collect published race-card batches and run storage audit.
4. Require Tokyo 11R official card complete + current source evidence.
5. Choose and record explicit track assumption.
6. Run `/v1/lab/prelock-build` for `2026-10-10 / 東京 / 11R`.
7. Run `/v1/lab/prelock-readiness`; require `readyToSeal=true` and inspect thin-history warnings.
8. Run `/v1/lab/prospective-seal` once.
9. Repeat the same request and require idempotent immutable response with identical SHA-256.
10. Continue all-race ingestion for remaining 10/11 and staggered 10/12 cards independently.
11. After the race, ingest official outcomes and validate against the exact locked hash; do not retune from the target result before validation.

## Remaining live verification

- Confirm Cloudflare is serving v3.8.2 after Git merge/deploy propagation.
- Observe a genuine `trigger_kind=scheduled` collection run; do not substitute manual scheduler evidence.
- Run the new branch test suites in an environment with the complete repository/runtime if no CI run appears.
- Verify `prelock-build` against the real Saudi RC field after the official card is stored.
- Verify the final Saudi RC Step 7 snapshot includes evidence-depth metadata and repeated-call hash identity.
