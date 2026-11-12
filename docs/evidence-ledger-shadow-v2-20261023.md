# Evidence ledger shadow v2: offline prototype, 2026-10-23

## Scope and limits

This is an isolated research module, not a complete replacement predictor. It is not imported by the Worker, scheduled collectors, current scorer, UI or LOCK code. No fetch, SQL or persistence is added. Existing safe-core and course-position models remain unchanged.

The input fixture is a reduced export from the independently read formal Kikka normal snapshot (saved 2026-10-23 07:18:51.491 JST). Original snapshot SHA: `7e3fb2ece5b77b73f4de664b9f0d42c47195e8efbe5cc0a70c7c0de9de7a71e4`. The reduced fixture is not the original snapshot JSON and does not itself have that SHA. Card, marks, ranks and scores are baseline references only. No target results are used.

## Implemented safeguards

- Count raw finish evidence once, as a descriptive result index, not two separately added ability/form scores.
- Accept class labels only from explicit verified, identity-bound evidence. Do not guess grades from race names or assign invented numerical grade premiums. Group class records without cross-class calibration.
- Keep ability, independent condition, distance evidence, data-field presence and predictive confidence separate. Missing confidence is null, not a percentage inferred from record count.
- Keep Kyoto venue experience separate from distance-extension facts. 2400/2500/2600m records do not certify 3000m suitability and lack of 3000m experience adds no penalty.
- Describe first-recorded-corner tendencies across historical same-surface distances. These are not 3000m predictions or evidence of settling ability. Slow/average/high scenarios have no assigned probabilities or score adjustments.
- Describe adjacent horse-number tendencies without a draw bonus. Jockey names add no points.
- Hold aggregate scores, ranks and marks until a defensible aggregation/class/condition policy exists. This prototype does not yet deliver improved ranked predictions.

## Remaining work before a ranked model PR is ready

Verified class/opponent evidence ingestion, independent race-adjusted condition features, scenario response validation, evidence-based aggregation and tie/mark rules, multi-date race validation, and a separately approved append-only storage/UI integration remain unimplemented. No accuracy gain is claimed.

## All 18 baseline versus prototype

All prototype aggregate scores/ranks/marks are held (null). The descriptive index is deliberately not an alternative prediction score. Field presence is measured over eight fields per input row; it is not a quality, completeness-of-model, or confidence percentage.

|No|Horse|Baseline rank/score/mark|Observed result index|2400–2600m starts|Longest input|Historical position tendency|Field cells|Prototype score/rank/mark|
|---:|---|---|---:|---:|---:|---|---|---|
|1|エムズビギン|16 / 50.9 / —|47.84|2|2400|middle|24/24|held / held / held|
|2|コンジェスタス|10 / 74.3 / —|67.65|2|2400|unknown|18/24|held / held / held|
|3|アウダーシア|8 / 75.4 / —|75.95|1|2400|unknown|18/24|held / held / held|
|4|ショウナンガルフ|18 / 23 / —|21.96|1|2400|back|24/24|held / held / held|
|5|ジャスティンシカゴ|3 / 97.9 / ▲|97.62|0|2200|unknown|18/24|held / held / held|
|6|バステール|17 / 49 / —|49.8|1|2400|unknown|18/24|held / held / held|
|7|ラージアンサンブル|13 / 71.4 / —|72.94|0|2200|middle|24/24|held / held / held|
|8|ロブチェン|1 / 100 / ◎|100|2|2400|unknown|18/24|held / held / held|
|9|ゴーイントゥスカイ|6 / 81.8 / —|83.01|2|2400|unknown|18/24|held / held / held|
|10|ダノンヒストリー|5 / 83.8 / ☆|81.82|2|2600|unknown|18/24|held / held / held|
|11|アスクエジンバラ|14 / 69.7 / —|69.8|1|2400|unknown|18/24|held / held / held|
|12|サノノグレーター|15 / 61.4 / —|62.09|0|2200|unknown|18/24|held / held / held|
|13|キンググローリー|11 / 73.9 / —|70.95|2|2600|front|24/24|held / held / held|
|14|マジョレルブルー|1 / 100 / ◎|100|2|2400|front|24/24|held / held / held|
|15|シートゥサミット|4 / 92.8 / △|91.11|3|2400|unknown|18/24|held / held / held|
|16|ショウナンハヤナミ|9 / 75 / —|70|1|2400|middle|24/24|held / held / held|
|17|チャリングクロス|7 / 79.8 / —|81.82|1|2400|middle|24/24|held / held / held|
|18|ナリタエスペランサ|12 / 72.8 / —|75.56|1|2600|front|24/24|held / held / held|

All 54 input rows lack explicit verified class metadata. The first-corner descriptive distribution is front 3 / middle 4 / back 1 / unknown 10, across mixed distances. Primary last3f and cornerPositions are each present on 24/54 rows (10 horses lack both on all three primary rows). An earlier report of 27/54 and nine horses was a counting error. Supplementary rows are not substituted or double-counted.

## Production evidence observed separately

- 72-slot metadata: Saturday formal cards 0, expected rosters 14, provisional predictions 13; Sunday formal cards 1, expected-only rosters 10, provisional predictions 11. Combined roster availability 25, provisional predictions 24, no increase from prior metadata. Formal normal predictions are a separate table.
- Formal comparison saved naturally at 09:00:10.529 JST, 18 evaluated / 0 held / 54 input rows, model course-position-shadow-v1-formal-card-v1. Independent GET and rehash match `a57ec0ce9332e36897242c0891e4825a909a3edc39284118f6cee47288f292ff`; baseline points to the original formal normal SHA. Old 21-runner snapshot is not overwritten.
- That saved comparison is the previously released v1 scoring policy; it is NOT this v2 prototype.
- Existing LABO prediction GET reports locked:false. Card audit/immutable normal snapshot do not establish a formal prospective seal. No mark or track assumption is supplied by this work.
- Latest observed history 09:24:50.985–09:25:00.096 JST found a Kyoto Oct25 R9 official card link, external requests 1, formalCardsCreated:false. No card save is claimed.
- Latest archive at 09:18 failed with D1_ERROR: Network connection lost. This is not evidence of the daily quota being exceeded.
- Normal provisional 09:00 awaiting-data Niigata Oct24 R1: 3785 read / 2 write / 15 queries / 1774ms; nextAttempt 11:00:08.284 JST.
- Formal comparison 09:00: 1468 read / 7 write / 17 queries / 2665ms. Values cover only that operation, not account usage or verification GETs.

## Validation

Eight focused tests cover baseline/input preservation, class provenance, missing data, distance boundaries, scenarios/jockey non-scoring, leakage/duplicates, identity rejection and replay of the real reduced 18-horse input. Full repository suite is run separately. No production model switch or deployment is authorized by this prototype.
