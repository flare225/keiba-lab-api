# KEIBA LABO Work handoff — v3.8.6 — 2026-10-05 JST

## Current verified production state

- Repository: `flare225/keiba-lab-api`
- Active Worker entry: `src/index-v3.8.6.js`
- Public Worker: `https://keiba-lab-api.sekai-no-bancyou.workers.dev`
- Verified runtime checkpoint before this handoff commit: `6254062dea80b11e3ef69b148b5d1a27b5d7c3f2`
- Public deploy check returned **v3.8.6** at 2026-10-05T08:13:25Z = **17:13:25 JST**.
- Main Node CI run #21 passed: active Worker syntax + full Node suite green.
- Production smoke run #6 passed all stages, including the Saudi RC pre-card schema/seed audit.

## Cron remains proven live

Production smoke reported:

- `cronHeartbeat = observed`
- configured Cron: `0 * * * *`
- latest scheduled run: `scheduled:2026-10-05T08:00:24.000Z:0 * * * *`
- scheduled: **17:00:24 JST**
- started: 17:00:25 JST
- finished: 17:00:41 JST
- status: `cards-not-discovered`
- attempted: 16
- saved cards: 0
- saved runners: 0
- missing cards: 16
- failed cards: 0
- source errors: 0

This is expected before official numbered race-card publication. The important signal is that the genuine scheduled trigger completed with zero failed-card/source-error counts.

## Program layer

Weekend staging remains intact:

- 2026-10-10: 24 races (Tokyo 12 + Kyoto 12)
- 2026-10-11: 24 races (Tokyo 12 + Kyoto 12)
- 2026-10-12: 24 races (Tokyo 12 + Kyoto 12)
- total: **72 races**

The v3.8.1 five-phase scheduler still covers the nine date/slot batches as `2 + 2 + 2 + 2 + 1`, so all 72 race-card slots can be touched within a complete five-hour phase cycle without increasing the peak hourly ingestion load.

## v3.8.5 — isolated pre-card context layer

Purpose: use JRA's Saudi RC `horse.html` information from 2026-10-06 without contaminating the authoritative numbered-card or prospective-LOCK layers.

Dedicated tables:

- `lab_precard_targets`
- `lab_precard_runner_context`
- `lab_precard_source_evidence`

Default staged target:

- race key: `2026-10-10:東京:11`
- race: サウジアラビアロイヤルカップ
- official source: `https://www.jra.go.jp/keiba/race/092/horse.html`
- not-before: `2026-10-06` JST

The scheduled pre-card sweep is inherited by v3.8.6:

- before the first successful publication snapshot: eligible target is checked each hourly Cron run
- after successful publication: refresh backs off to six hours
- after the target race date: it stops refreshing
- source redirects off the official JRA `horse.html` path are rejected
- race-name/date identity mismatch is rejected

Extracted pre-card fields:

- horse name
- sex / age
- trainer / stable
- sire / dam / damsire
- JRA focus text
- source SHA-256

Published context rows are stored before the corresponding published source-evidence SHA is committed, preventing a source snapshot from appearing successfully committed while runner-context persistence is incomplete.

### Hard separation from the official card

Pre-card context:

- does **not** write `jra_races`
- does **not** write `jra_runners`
- never infers horse numbers
- is not authoritative for the race card
- is not eligible for prospective sealing
- can never replace the official numbered JRA card

## v3.8.6 — bootstrap-safe pre-card audit

Production smoke exposed that the first v3.8.5 status audit could fail in a legitimate pre-publication database state when optional history/card tables were not yet available.

v3.8.6 wraps `/v1/lab/precard-context-status` so optional evidence is fail-soft:

- missing `jra_past_performances` => zero history evidence, not HTTP 500
- missing/not-yet-populated `jra_races` => official card not yet stored
- missing/not-yet-populated `jra_runners` => no official runner comparison yet

The dedicated `lab_precard_*` schema and target seed remain required and are created/validated normally.

A regression test now mocks a D1 database with the optional history/card tables absent and requires the pre-card status endpoint to remain green.

## Saudi RC production pre-card seed — VERIFIED

Production smoke at approximately 17:13 JST returned:

- `ok = true`
- version: `3.8.6`
- race key: `2026-10-10:東京:11`
- race name: サウジアラビアロイヤルカップ
- target status: **`staged`**
- featured runner count: **0**
- official-card comparison: **`official-card-not-yet-stored`**
- warnings: none
- source evidence aligned: true

Guardrails verified in production:

- `writesJraRunners = false`
- `writesJraRaces = false`
- `authoritativeForCard = false`
- `eligibleForProspectiveSeal = false`
- `officialNumberedCardStillRequired = true`
- `horseNumbersNeverInferredFromPrecardPage = true`

Therefore the production D1 schema and Saudi RC seed are ready before the 2026-10-06 runner-info publication window.

## Production smoke hardening incident

Two useful failures were found and fixed before runner-info publication:

1. The first pre-card status integration exposed the optional-table bootstrap problem described above; fixed in v3.8.6 and covered by regression test.
2. The smoke workflow initially used jq expressions like `false // true`, which incorrectly converted legitimate false guardrails into true. The workflow now reads the boolean fields directly and prints the pre-card response before assertions for future diagnostics.

The final Production smoke run #6 is green.

## Existing prelock safety baseline remains unchanged

v3.8.0–v3.8.4 protections remain active beneath v3.8.6:

- explicit track assumption required
- official numbered-card evidence required
- target-scoped readiness
- prelock feature build
- seven fresh build stages required for a new seal
- all-runner core feature coverage required
- evidence-depth metadata frozen in the immutable snapshot
- `seal=1&confirm=LOCK` required for one-call sealing
- first/second seal calls must be immutable + idempotent + identical SHA-256
- already sealed targets are re-verified without rebuilding mutable pre-race features
- strict prospective cohort validation excludes post-race reconstruction locks

## Next operational sequence

### 2026-10-06 — JRA runner information

1. Keep the Saudi RC target in the isolated pre-card layer.
2. Cron is eligible to query the JRA `horse.html` page from the start of 2026-10-06 JST.
3. While JRA still shows a publication placeholder, record non-publication explicitly; do not create official card rows.
4. Once runner information is published, save the isolated context + source SHA-256.
5. Run/inspect `/v1/lab/precard-context-status`:
   - runner count
   - age-2 count
   - pedigree/trainer coverage
   - zero/one/two-plus pre-race history depth when available
   - warnings
6. Use this only for pre-analysis context. **Do not prospective-LOCK.**

### 2026-10-08 — official numbered race card

1. Allow the all-race card collector to save the official card into `jra_races` / `jra_runners`.
2. Run storage audit for Tokyo 11R.
3. Re-run pre-card status and inspect the automatic name diff:
   - matched
   - featured but not on official card
   - official-card runner not featured on pre-card page
4. Require official card runner count/evidence/fingerprint integrity.
5. Record explicit track assumption.
6. Run `/v1/lab/prelock-run` prepare mode.
7. Require all seven fresh stages + core feature audit green; inspect thin-history warnings.
8. Only then run `seal=1&confirm=LOCK` using the exact same track assumption.
9. Require `verificationComplete=true` and identical immutable SHA-256.

### After the Saudi RC

- ingest official outcome
- score the exact locked hash
- include it in strict prospective cohort audit
- never retune from the Saudi RC result before scoring the locked prediction

## Current status in one line

**Production v3.8.6 + real Cron + 72-race program staging + isolated Saudi RC pre-card schema/seed + non-LOCK guardrails are all verified; next live dependency is JRA runner-info publication on 2026-10-06.**
