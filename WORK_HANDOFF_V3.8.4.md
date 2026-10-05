# KEIBA LABO Work handoff — v3.8.4 — 2026-10-05 JST

## Current verified state

- Repository: `flare225/keiba-lab-api`
- Worker entry: `src/index-v3.8.4.js`
- Public Worker: `https://keiba-lab-api.sekai-no-bancyou.workers.dev`
- Production smoke verified the public Worker was serving **v3.8.4** at 2026-10-05T07:41:24Z (16:41:24 JST).
- GitHub Actions `Production smoke` run #1 completed successfully.
- Node test CI also remains enabled on PRs and pushes to main.

## Cron is now proven live

This is no longer an unverified assumption.

The production `/v1/lab/scheduler-status` response observed by GitHub Actions reported:

- `cronHeartbeat = observed`
- configured Cron: `0 * * * *`
- latest scheduled run ID: `scheduled:2026-10-05T07:00:24.000Z:0 * * * *`
- scheduled: 2026-10-05T07:00:24Z = **16:00:24 JST**
- started: 2026-10-05T07:00:25.049Z
- finished: 2026-10-05T07:00:42.485Z
- trigger kind: `scheduled`
- status: `cards-not-discovered`
- attempted card slots: 16
- saved cards: 0
- saved runners: 0
- missing cards: 16
- failed cards: 0
- source errors: 0
- scheduler rotation version: `3.8.1`

`cards-not-discovered` is expected before the official numbered race cards are published and is not treated as proof of nonpublication. The important operational fact is that a genuine scheduled trigger has now been observed and completed without collection/source errors.

## Program staging state

The observed scheduled run confirmed the pre-staged weekend program layer remains intact:

- 2026-10-10: 24 races (Tokyo 12 + Kyoto 12)
- 2026-10-11: 24 races (Tokyo 12 + Kyoto 12)
- 2026-10-12: 24 races (Tokyo 12 + Kyoto 12)
- total: **72 races**

The scheduler's broader date discovery scan also received expected 403/unavailable responses for dates before the meeting window. Those responses did not count as card-source errors for the staged weekend collection.

## v3.8.0 — target-scoped prelock readiness

- `/v1/lab/prelock-readiness`
- explicit `track` assumption required for prospective sealing
- no silent default to `良` at the outer gate
- Saudi RC readiness is independent of unrelated later cards
- official card evidence, runner identity, no-outcome and immutable-seal guards retained

## v3.8.1 — fast publication sweep

- Three race dates × three 8-card slots = nine unique batches.
- Five hourly phases cover the nine batches as `2 + 2 + 2 + 2 + 1`.
- Maximum hourly card-ingestion load remains two 8-card batches.
- All 72 slots can be touched within a complete five-phase cycle without duplicate date/slot batches.
- Real Cron execution is now confirmed in production.

## v3.8.2 — prelock feature build + evidence-depth freeze

- `/v1/lab/prelock-build`
- Builds pre-race history, track bias, base ranking, pace/style, neutral pace fill, provisional condition and workout overlay without writing a seal.
- Core coverage must be complete for every runner for basic ability, recent performance, pace/style and integrated prelock output.
- Thin two-year-old history is recorded as evidence depth rather than used to mutate target-race weights.
- Step 7 snapshots freeze per-runner history-row count, base-model coverage and base evidence confidence inside the SHA-256-protected snapshot.

## v3.8.3 — strict prospective cohort validation

- `/v1/lab/prospective-cohort-audit`
- Default scope is two-year-old runners; `scope=all` is also available.
- Only strict future-day prospective seals are eligible.
- Reconstruction locks are excluded.
- Stored SHA-256 is recomputed and verified before scoring.
- Complete official outcomes are required.
- 0–1 history rows and 2+ history rows are evaluated separately for rank error/top-3 behavior.
- Confidence bands are reported separately when sealed confidence exists.
- Small samples are diagnostic only; no automatic weight changes are allowed.

## v3.8.4 — one-call prelock orchestration

Endpoint: `/v1/lab/prelock-run`

### Prepare mode

Required inputs:

- `date`
- `venue`
- `race_no`
- explicit `track`

For a new seal candidate it executes:

1. prelock feature build
2. fresh-stage audit
3. core-feature audit
4. prelock readiness
5. returns warnings/blockers without sealing

A stale database snapshot cannot make the run green by itself. All seven current build stages must report green:

- history
- trackBias
- baseRank
- paceStyle
- paceNeutralFill
- provisional100
- workoutOverlay

### Seal mode

Requires both:

- `seal=1`
- `confirm=LOCK`

For a new seal it executes:

1. fresh build
2. readiness gate
3. immutable prospective seal
4. second identical seal call
5. requires second call to be idempotent
6. requires both responses immutable
7. requires identical, well-formed SHA-256

Success is not reported unless the identity check passes.

If the exact race + track assumption is already sealed, v3.8.4 skips rebuilding mutable features and uses the immutable Step 7 path twice to re-verify the stored seal/hash instead of attempting a reseal.

## Production smoke automation

Workflow: `.github/workflows/production-smoke.yml`

On every push to main it:

1. derives the expected Worker version from `wrangler.jsonc`
2. queries the public `/v1/lab/deploy-check`
3. requires production to serve the same version
4. queries `/v1/lab/scheduler-status`
5. reports the current Cron heartbeat in the Actions summary

`not-observed`/`overdue` is reported but is deliberately not treated as a deployment-version failure; scheduler health and deployment identity remain distinct signals.

The first production smoke run passed and established both production v3.8.4 and a real observed scheduled Cron run.

## Saudi RC operating sequence

Target remains 2026-10-10 Tokyo 11R (Saudi Arabia Royal Cup). Do not wait for all 72 weekend cards before sealing this target.

After the official Saudi RC numbered card is stored:

1. Confirm production smoke remains green and version is current.
2. Confirm the real card has complete runner rows and official source evidence.
3. Run storage audit for Tokyo 11R.
4. Record an explicit pre-race track assumption; do not silently assume `良`.
5. Run `/v1/lab/prelock-run` in prepare mode.
6. Review build status, core coverage, thin-history warnings and workout/condition evidence.
7. Only if the prepare run is green, run the same endpoint with `seal=1&confirm=LOCK` and the exact same track assumption.
8. Require `verificationComplete=true` and identical SHA-256 identity.
9. Never tune the target-race weights after seeing the Saudi RC result.
10. After the race, ingest official outcomes and score the exact locked hash through prospective validation/cohort audit.

## Publication timing reminder

- Saudi RC runner information: scheduled 2026-10-06.
- Official Saudi RC numbered race card: scheduled 2026-10-08.
- 2026-10-12 cards are staggered later, so weekend-wide 72/72 card completeness is intentionally not a Saudi RC lock prerequisite.

## Remaining live work

- Continue automated all-race collection as cards publish.
- On 2026-10-06, ingest/use Saudi RC runner information only as pre-analysis context; do not prospective-LOCK from that page alone.
- On official numbered-card publication, run the real Tokyo 11R storage audit and v3.8.4 prelock orchestration.
- Keep accumulating strict prospectively sealed races for v3.8.3 evidence-depth validation; do not change model weights from tiny samples.
