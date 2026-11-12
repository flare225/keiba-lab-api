# KEIBA LABO: purpose and completion criteria

Recorded 2026-10-17 JST from the owner's instructions and a local source review.

## Purpose

Help the owner make race decisions with an independent LABO assessment grounded
in available pre-race evidence; compare that assessment with the owner's marks;
preserve the actual pre-race decision; use subsequently collected results to
evaluate and improve the model. Data collection and dashboards support this
purpose and are not completion criteria by themselves.

## Required user journey

1. Import the published official card, including runner identity and numbering.
2. Collect historical evidence early enough to support the race decision. Keep
   JRA and secondary-source records separate, including URL and observation time.
3. Explain the independent assessment using actual available evidence, including
   position/pace and course/ground fit where supported. Missing evidence stays
   missing; popularity or editorial opinion must not replace it.
4. Compare the owner's marks against LABO's assessment without changing those marks.
5. Save and read back the selected final marks and pre-race lock, with the original
   assessment snapshot and source coverage. A successful HTTP response alone is
   not evidence of persistence.
6. Collect official results after the race, join them to that exact snapshot, and
   verify comparison results. Never reconstruct a pre-race snapshot after the race.
7. Accumulate eligible examples and evaluate model candidates on separate race
   dates. Never claim calibrated probabilities or improved accuracy without evidence.

## Source findings, not production findings

- `src/mark-comparison-core-v3.41.0.js` builds comparison reasons from results,
  recent performance, course/distance and ground. It explicitly states that
  pace/position fit and workouts are not included in its provisional index.
- `src/learning-experiment-v3.40.0.js` defines its fixed baseline with those four
  dimensions. Do not silently add new dimensions to the frozen experiment or
  overwrite existing prediction ranks/scores.
- `src/learning-readiness-v3.34.0.js` keeps automatic training/weight changes off.
  The existence of this code is not evidence that production examples exist.
- The local checkout contains prior status-cache changes. Do not accidentally
  bundle those existing changes into another commit.

## Immediate priority while D1 reads are exhausted

Do not repeatedly query production D1 or invent its current contents. After the
quota resets, verify the deployed revision, read existing saved marks/locks and
the matching comparison from the minimum necessary requests. If D1 is usable
and a flow fails, trace and repair that exact flow, test, deploy, then read back.
Preserve existing marks, locks, fixed ranks/scores and all historical snapshots.

## Reporting rules

Report distinct facts: code committed; tests passed; production revision verified;
records persisted and read back; comparison verified; eligible learning examples.
Never collapse these into “working” based on a page returning HTTP 200. Report
actual counts and the specific blocker. A test/merge is not production evidence.

## Public reference review, 2026-10-17 JST

JRA-VAN's published pairwise model description identifies running-style tendency,
relative race/closing times, distance/ground fit and the other runners' styles as
inputs: https://jra-van.jp/fun/dm/game_mining.html (historical model description,
not a claim about its current private implementation).
netkeiba's product description exposes pace, race time and front/back 3F forecasts:
https://race.netkeiba.com/AI/AI.html . Neither source publishes enough details here
to reproduce its trained model or substantiate accuracy claims for LABO.

The first implementation step exposes LABO's already-computed comparable
prior-position evidence in both comparison clients: trend, valid observation
count, classification threshold and limits. It adds no DB calls and no weights.
Next priorities are complete source-attributed passage/closing-time collection,
race-relative time features (only with a complete comparable race), and a new
separately versioned experiment for pace/position features. New model dimensions
must not mutate the existing frozen experiment. Probability calibration and
odds-based expected value follow measured out-of-date validation, not raw scores.

## Operations readback, 2026-10-18 12:30 JST

Use the application's native Node.js fetch client for authorized Worker operations.
The local Python urllib client returned Cloudflare HTTP403/error1010 while Node's
standard fetch returned HTTP200 from the identical deploy-check endpoint in the
same environment. No alternate hostname, browser impersonation, or security-rule
change was needed. A failed Python request does not establish that Worker/D1 is
unavailable. Never replay writes to diagnose a read failure.

Node readback confirmed final marks and hash-verified immutable locks for Fuji S
(14 entries, revision 6, lock 2026-10-17T06:32:13.879Z, deadline 06:45Z) and Shuka
Sho (17 entries, revision 1, lock 2026-10-18T02:17:52.157Z, deadline 06:40Z).
Both official cards and at least three stored history rows per runner exist.
Fuji S official profile histories still have zero last3f observations; basic row
coverage must not be described as complete rich-history coverage.

Work-progress reported 33 eligible training races over two days and a created
candidate. Validation had 2 races over two days against the minimum of 10 races;
canReviewCandidate was false. These counts are point-in-time observations, not
an accuracy improvement claim or permission to rebuild past pre-race features.

## Standing decisions and implementation ledger — 2026-10-19 JST

Read this file and the collection audit before resuming. Earlier dated status is
historical evidence, not current production state. Check existing implementation
before proposing or repeating a fix. Never substitute this ledger for live DB
readback when making a current persistence claim.

### Owner priorities, in order

1. Collect this week's named runners and reuse their existing past starts before
   spending requests on missing starts. Cover ordinary races and all meetings,
   not only graded races. Programs alone are not entrant data.
2. Aim for usable provisional independent LABO assessment by Thursday, Friday at
   the latest. Kikuka Sho's October 22 Thursday draw is the owner's explicit
   deadline cue: do not wait until Friday to ingest its official draw. Verify the
   published official card when available. Other weekend cards follow publication.
3. Preserve the actual pre-race LABO assessment with the owner's marks and LOCK;
   compare official results with that exact revision, not a newer revision.
4. Accumulate genuinely eligible examples and connect a separate model pipeline.
   Candidate storage is not model training, promotion or demonstrated improvement.
5. Improve readable mobile comparison and understandable bet combinations/costs.
   Never allow interface changes to displace time-sensitive source acquisition.

Use free infrastructure. Reuse stored evidence; avoid repeated status polling,
full-field rechecks, test writes and automatic DB smoke on every UI deployment.
Source acquisition shares its existing lease, budget and cooldown: one horse or
one result page per batch, >=60 seconds between batches, at most two successful
source batches per execution. On 403/429/503 stop acquisition in that execution.
Do not change hosts or use netkeiba to bypass a shared stop. Public secondary
sources may supplement after the gate opens; record provider, URL and observation
time separately. No paywall/login/access-control bypass.

### Implementations to retain and reuse

- Immutable user-mark revisions, DB readback/reload restoration and explicit
  pre-start LOCK already exist. Owner authentication configuration exists; do
  not recreate the owner workflow or ask for secrets for unrelated collection.
- Independent whole-field reference assessment is saved inside mark audit JSON.
  Absence of a separate prospective seal does NOT mean absence of a pre-race
  reference assessment. Resolve the exact revision identified by LOCK.
- API PR162: scheduled live coverage targets three valid prior starts and reuses
  stored rows; that target does not prove lifetime or rich-field completeness.
- API PR163: prelock preparation uses stored histories and stops dependent stages
  after failures; it does not unconditionally bulk-fetch history.
- API PR164: bounded shared-gate program discovery, future card handoff and
  discovery receipts replace old large hourly card/program sweeps.
- API PR165: fair source dispatch keeps archive/results/history in separate turns,
  preventing an unfinished history queue from starving result collection.
- API PR166: stored verified pre-draw rosters feed generic upcoming one-horse
  history collection, beyond the static expected-source list.
- API PR167: ordinary scheduled history batch size is one horse.
- API PR168: separate immutable post-race review. This is NOT pre-race training
  evidence and must never replace the owner's actual saved pre-race assessment.
- API PR169: preserve exact LOCK-linked reference features, without recomputation,
  in lab_saved_reference_features_v1.
- API PR170: bind complete preserved features to verified immutable result evidence
  in lab_saved_reference_labels_v1, separate from the old frozen experiment.
- API PR171: GET saved-pre-race-assessment reads and verifies saved candidate labels.
- API PR172: GET week-data-inventory separates programs, expected snapshots,
  confirmed pre-draw rosters, formal cards and valid prior-start coverage.
- Frontend PR88: readable ticket draft, duplicates, added cost and budget checks.
  Ticket browser storage is NOT formal DB persistence or a learned AI prediction.
- Frontend PR89: DB-writing/reading smoke steps run only on manual dispatch, not
  automatically on every UI push. Lightweight deployment checks remain.
- Comparison position evidence and mobile readability changes already exist.
  Displayed position evidence does not imply pace/workout dimensions were trained.

### Verified production evidence, October 19

- October 17 result rows: 68; richly complete races: 5. October 18: 53 rows,
  4 richly complete races. Total 121 rows / 9 richly complete races. These are
  observed status totals, NOT all-weekend completion.
- All six main races on October 17/18: 87 runners, official result detail complete.
- Owner final marks and pre-start LOCK verified for Fuji S14, Shuka17, Brazil C13,
  Niigata Himba S10. Matching immutable result comparisons exist for all four.
- Complete separate pre-race reference learning candidates: Fuji S14 + Shuka17,
  two races / 31 runners. No model training or validated accuracy credit claimed.
- Brazil C has 13 unavailable original LABO assessments; Niigata Himba S has9.
  Their original partial reference records are preserved and user-mark/result
  comparisons remain useful. Never backfill their pre-race scores after results.
- Shuka LOCK links revision1; latest user-mark revision3 is a different record.
- Week October24/25: programs36+36=72; formal cards0. PR172 live inventory also
  found zero stored expected/confirmed pre-draw rosters. Prior history sufficiency
  cannot be assessed for unnamed entrants. The old October25 race data was a
  program, not proof of a saved entrant roster. Do not fetch the programs again
  merely because names are missing.

### Outstanding work

Acquire source-attributed upcoming entrant rosters, save them through an actual
supported ingest route and then reuse/collect prior starts. Formal cards and
numbering follow official publication. Connect the separate saved-reference
cohort to a separately evaluated learning pipeline; do not pour it into the old
frozen experiment. Workout feed remains unconfigured at last verification;
no claim of functioning workout acquisition. Calibrated probabilities, betting
expected value and demonstrated prediction improvement remain unestablished.
