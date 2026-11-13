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

## 2026-11-13 継続目標：毎週土日のメインを完走する運用

ユーザー最新指示：「毎週土日メインだけ完璧に揃えられる体制」「この流れを忘れないで継続」。今週の個別馬名・日付・対象数を次週へ固定しない。開催番組から各土日の開催場メインを特定し、対象を限定する。全レース取得へ拡大しない。この目標は一時的な進捗報告ではなく継続要件とする。

### 完走と品質の定義
各対象で、公式枠馬番カード→不足履歴・上がり/同馬/重複・競合検証→通常独立予想保存→独立snapshot SHA→発走前LOCK→全馬公式結果照合→元LOCKに結び付く学習候補保存/独立SHAまで追う。予想/LOCKの証拠には11/13エリ女の受入手順、結果接続にはPR363のテスト済み手順を再利用する。未来の結果・候補はまだ本番受入前。
全頭数・過去走行数・checked/pending0だけで完成にしない。1〜2走しかない実競走歴、欠損3F、競合は正直に残し、捏造・無条件評価昇格・発走後の予想再生成で埋めない。入力不足で通常予想が成立しない対象は未達として期限前に通知する。

### 今週と実装順序
現在のエリ女凍結は維持し、実際の工程停止バグのみ修正可。土曜2Rは許可済データ取得範囲の残件を続ける。今回の継続体制要望を根拠に、今週の追加レース予想/LOCKを無検証で有効化しない。
エリ女の結果→候補まで受入後、次の通常実装として以下を順に進める。再指示を開始条件にせず、既存承認のexact-head CI→必要merge/公開→本番受入を守る。
1. 外部取得と保存済入力の処理を分離。現行focused-race-completionの正式分岐はcollectHistoryBatch全体をsource-coordinatorのhistory枠へ入れ、保存済cache-onlyも18分/対象交互36分待ちになる。保存済み処理専用経路を抽出し、HTTPへfallbackできない構造にする。source coordinatorの取得頻度/共有gate/lease/403等は維持。外部0でもD1は消費するので、bounded batch・変更revision単位のreceipt・実測read量を必須とし、毎回全馬走査を避ける。
2. 週次対象台帳と期限優先キュー。番組根拠/対象日/開催場/レース/発走時刻を保存し、未保存・入力変更・未検証だけ進める。完成済/待機中/取得期限超過は判定して、完成済京都が交互枠を使うような無進捗選択を減らす。完了・待機対象を飛ばしても外部取得総枠を増やさず、他対象の冷却/leaseを代替実行で迂回しない。
3. 保存後のハンドオフ。入力revision変更→対象再評価→通常予想保存/独立照合→期限前LOCKの状態を、対象別に永続化する。成功後の反復GET/予想再生成/再LOCKをしない。再起動で途中から再開し、他レースのcheckpointを継承しない。
4. 水〜木に公開根拠のある名簿/履歴を先行準備し、金曜の枠順公開後に正式カードを照合して通常予想へ。土曜レースは金曜夕方、日曜レースは土曜夕方を準備完了の運用目標とし、実際の公開時刻・安全制御により未達ならその日のうちに工程/原因/見込みを通知。LOCK締切は各公式発走前の既存規則を守る。
5. レース後は対象別に公式結果→候補へ切替。全場再開せず、元LOCK SHAを保存して照合。保留レースが他の完了を止めない。学習候補と学習済みを区別し、自動重み変更/無条件shadow昇格なし。

### 実装の受入テスト（これから実施、成功扱いしない）
- 2開催日・最大3場/日・18頭/対象のfixtureで、週切替/対象隔離/期限順/途中再起動を通し、前週馬名やcheckpointが混入しない。
- cache-only専用経路はfetcherを呼ぶと失敗するテストでHTTP0を保証。入力変更なし2回目の処理は追加保存/再評価/再LOCK0。D1上限例外で後続停止、bounded読み取り量を測定する。
- 完了・待機・403/429/503・lease対象を含む混在で、source総枠・間隔・receipt期限不変、待機先への早期再要求0、別対象の状態汚染0。
- 全馬正式/入力品質/通常snapshot独立SHA/期限前LOCK/全馬結果/候補SHA/元LOCK不変を同じ実writer経路で通す。部分結果・未知status・原SHA不一致・対象違い・欠損は完了にしない。
- 本番は対象限定の新保存証拠だけ独立受入し、週末メイン全対象の各工程時刻・未達理由・実測負荷を残す。テスト成功や公開を本番完走と称さない。
