# KEIBA LABO Work handoff — v3.8.8 — 2026-10-05 JST

## Current verified production state

- Repository: `flare225/keiba-lab-api`
- Active Worker entry: `src/index-v3.8.8.js`
- Public Worker: `https://keiba-lab-api.sekai-no-bancyou.workers.dev`
- Production deploy-check returned **v3.8.8** at 2026-10-05T08:55:39Z = **17:55:39 JST**.
- Main Node CI run #26 passed: dynamic active-Worker resolution, active Worker syntax check, and full Node suite all green.
- Production smoke run #9 passed all stages.
- Cron heartbeat remains `observed`.
- Saudi RC pre-card target remains healthy and `staged` before the 2026-10-06 runner-info publication window.

## User-mark layer — now implemented

The app/backend now has a first-class human-decision layer for the user's racing marks.

Supported marks:

- ◎
- ○
- ▲
- △
- ☆
- 注
- 消

Supported decision phases:

1. `initial`
2. `post_draw`
3. `final`

### Core principle

**Human marks are independent inputs and never mutate LABO model scores or ranks.**

The mark layer compares the user's view against stored LABO evidence and surfaces agreement/disagreement. It does not reward a horse merely because the user marked it highly.

Production capability checks report:

- `humanMarksAreIndependentInput = true`
- `scoreMutation = false`
- `officialCardRequiredForPostDrawAndFinal = true`
- `officialCardEvidenceRequired = true`
- `initialCanUseIsolatedPrecardNames = true`
- `horseNumbersNeverInferredBeforeOfficialCard = true`
- `auditSnapshotPersistedWithRevision = true`
- `nullEvidenceNeverPresentedAsZero = true`

## Endpoints

### Capability / app integration

`GET /v1/lab/user-mark-capabilities`

Returns supported phases/marks, safety principles, and whether authenticated mark persistence is currently enabled.

### Read-only DB crosscheck

`POST /v1/lab/user-mark-audit`

This is the app-facing path for “the user applied marks; re-check those choices against the database now”.

The endpoint does not persist the user's marks and does not mutate model output.

### Persist mark revision + frozen audit

`POST /v1/lab/user-marks`

Requires:

- authenticated Bearer write secret (`USER_MARK_WRITE_TOKEN`)
- `confirm=SAVE`

Successful saves create an immutable-style revision record containing the user's mark payload hash and the corresponding DB audit snapshot hash.

### Read latest mark revisions

`GET /v1/lab/user-marks?date=YYYY-MM-DD&venue=...&race_no=N`

Can optionally filter by decision phase.

## Mark revision storage

Dedicated tables are created on first save/read-history use:

- `lab_user_mark_revisions`
- `lab_user_mark_entries`

A revision stores:

- race identity
- phase
- revision number
- track condition actually used by the audit
- identity basis
- mark payload SHA-256
- audit SHA-256
- frozen audit JSON
- timestamp

Individual entries store:

- horse number (nullable before official card)
- horse name
- mark
- optional note
- input order

This makes `initial -> post_draw -> final` changes auditable after the race without overwriting earlier human judgment.

## What is crosschecked after the official card

For each marked horse, the DB audit can surface available stored evidence including:

- LABO integrated rank
- LABO integrated score
- basic ability component
- recent performance component
- pace/style component
- course/distance component
- ground/track component
- condition/preparation component
- model coverage
- model confidence
- running-style evidence
- pace bias
- lane bias
- bias confidence
- pace-fit score
- condition evidence confidence
- condition signal count
- pre-race history depth
- frame number
- jockey
- trainer
- assigned weight
- sex / age
- isolated pre-card stable/pedigree/JRA focus context when available

The response also returns up to several **unmarked LABO top candidates**, which is specifically meant to catch a strong database horse the user may have overlooked.

## Human-vs-LABO disagreement flags

The mark layer intentionally challenges the human selection rather than agreeing with it automatically.

Examples:

- ◎ inside LABO top 3 -> aligned
- ◎ LABO rank 4–6 -> high-priority watch
- ◎ LABO rank 7+ -> critical conflict
- ○ inside LABO top 4 -> aligned
- ○ LABO rank 8+ -> high-priority conflict
- 消 inside LABO top 4 -> critical conflict
- 消 LABO rank 5–7 -> high-priority watch

These are review triggers, not automatic score adjustments.

## v3.8.8 official-card evidence hardening

Post-draw/final mark auditing is no longer allowed to trust a simple runner-count match.

When an official card exists, the mark layer now calls the same official-card evidence verifier used by prospective LOCK and requires the current stored evidence/fingerprint to agree with the DB card.

The audit therefore verifies the official source/card identity before using horse numbers.

Verified evidence metadata is attached to the mark audit snapshot, including where available:

- source SHA-256
- runner fingerprint SHA-256
- declared count
- parsed/source row count
- count basis
- official card fetched time
- verification time

If the official card or its current evidence is incomplete/mismatched, the mark crosscheck fails closed.

## v3.8.8 NULL-evidence correction

A v3.8.7 display helper could render a true database NULL numeric value as `0` because JavaScript `Number(null) === 0`.

v3.8.8 repairs mark-audit responses against the raw DB rows before returning/freeze-saving them.

Therefore unavailable model evidence remains **NULL / unavailable**, not a synthetic zero score.

This matters for two-year-old races where evidence can genuinely be sparse.

## Before the official card — initial marks

Before the numbered JRA card is stored, only `initial` marks are accepted.

They can reference horse names from the isolated Saudi RC pre-card context after that JRA runner-info page is actually published and stored.

Guardrails:

- horse numbers are forbidden before the official card
- horse numbers are never inferred from JRA `horse.html`
- pre-card context remains non-authoritative
- pre-card-only audit is not decision-ready for final LOCK

## After the official card — post-draw / final marks

`post_draw` and `final` require the verified official numbered card.

For `final`, an explicit track assumption is required.

This allows the app to compare the final human judgment with the same track-specific LABO evidence that will feed the prelock workflow.

## Current write-auth state

Production capability output at approximately 17:55 JST reported:

- `writeReady = false`

Therefore:

- read-only mark -> DB crosscheck is deployed and available
- human mark scores/ranks remain non-mutating
- permanent mark-history writes are intentionally fail-closed until `USER_MARK_WRITE_TOKEN` is configured as a Cloudflare Worker secret

No unauthenticated fallback should be added merely to make writes convenient.

The current environment did not expose a connected Cloudflare management integration capable of setting the Worker secret, so the secret has not been fabricated or committed to GitHub.

## CI improvement discovered during this work

The Node workflow previously claimed to syntax-check the active Worker but still hard-coded `src/index-v3.8.2.js`.

This was fixed in v3.8.7.

CI now resolves the active Worker path dynamically from `wrangler.jsonc`, verifies the file exists, and syntax-checks that exact entry before running the full test suite.

This is already green for v3.8.8.

## Saudi RC operational sequence with user marks

### 2026-10-06 — isolated JRA runner information

1. Cron watches the Saudi RC `horse.html` target from the publication window.
2. Store pre-card runner context only after publication is verified.
3. The user may create **initial** marks by horse name.
4. Run `user-mark-audit` to compare those marks with available pre-card context/history depth.
5. Do not infer horse numbers and do not LOCK.

### 2026-10-08 — official numbered card

1. Collector stores official Tokyo 11R card + all runners + source evidence.
2. Storage audit must pass.
3. Pre-card / official-card name diff is reviewed.
4. User applies **post_draw** marks.
5. App runs user-mark DB crosscheck.
6. Official card source/fingerprint evidence must pass before horse-number-based audit.
7. Inspect disagreement flags and unmarked LABO top candidates.

### Final race-day decision

1. Record explicit track assumption.
2. Run fresh prelock feature build / prelock orchestration as already defined.
3. User applies **final** marks.
4. Run the final mark DB crosscheck against the explicit-track model evidence.
5. Inspect any critical ◎/○/消 conflicts, thin-history warnings and missing evidence.
6. The human may keep or change the mark; the model is not silently altered either way.
7. Save the final human revision once authenticated write persistence is enabled.
8. Prospective model LOCK remains its own immutable process with its own SHA-256.

## After the race

Keep model LOCK evaluation and human-mark evaluation distinct.

This enables analysis of:

- where human judgment improved on the model
- where the model identified a horse the human missed
- how `initial -> post_draw -> final` human decisions changed
- whether a disagreement flag was useful
- whether thin evidence was over-trusted

Do not use the race result to rewrite the pre-race mark revision or model LOCK.

## Current status in one line

**Production v3.8.8 is live: user marks can trigger an independent DB crosscheck with verified official-card evidence, disagreement detection and NULL-safe evidence; permanent mark-history writes are safely gated pending Worker write-secret configuration.**
