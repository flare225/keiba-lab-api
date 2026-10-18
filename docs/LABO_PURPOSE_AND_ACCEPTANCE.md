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
