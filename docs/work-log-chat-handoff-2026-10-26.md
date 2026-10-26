# KEIBA LABO — 通常チャット引継ぎ実作業記録（2026-10-26）

> Work上限により通常チャットのGitHubコネクタで実施した範囲。**この記録は提案ブランチ内であり、main・本番DBには未反映。** 次のWorkは本書と `AGENTS.md`、`docs/work-log-2026-10-26.md`、`docs/LABO_PURPOSE_AND_ACCEPTANCE.md`、`docs/KEIBA_LABO_LESSONS_AND_RULES.md` を読み、重複作業を避けること。

## ユーザー指示・優先順位
- Work上限後も引き継げる作業を進め、実装・修正・検証・残件を事細かく記録する。
- **2026-10-31（土）・11-01（日）東京/京都48Rの発走前利用**を優先。過去開催の補完に全時間を使わない。
- 保存済みデータ/成功工程を再利用。403/429/503、共有gate、lease、D1制限を回避しない。既存LOCK正本・ユーザー印・凍結学習を変更しない。
- 本番マージ・Worker公開・DBスキーマ/トリガー作成は個別の確認が必要。今回一切実施していない。

## GitHub引継ぎで確認した事実
- backend `flare225/keiba-lab-api`、frontend `flare225/keiba-lab-apl`、作業管理Issue #178。
- 確認時mainは `05dcb83cde7ca525cd7e9c5d805047fcbe81bfbe`。候補 `proposal/saved-automatic-lock-readback` はmainより1コミット先行（作業開始時）。既存PRがあるため重複PR作成をGitHub 422が拒否。新PR作成なし。
- 提案差分9ファイル：`src/automatic-pre-race-prediction.js`、`src/card-evidence.js`、`src/index-v3.3.0.js`、`src/index-v3.49.0.js`、`src/prospective-seal-store.js`、新規 `src/saved-automatic-seal-input.js`、`src/saved-automatic-seal-queue.js`、`src/saved-automatic-seal.js`、`tests/saved-automatic-seal-input.test.mjs`。
- `scheduledSavedAutomaticSeal` は `enabled=false` が既定。保存済み予想を再採点せず元JSON/SHAでLOCKし、2表の原子的書込と独立READを試みる候補。cronの本番稼働やDB成功は確認していない。
- `src/saved-automatic-seal.js` は候補LOCK用にCREATE TRIGGERを実行するため、マージ/公開前に本番DDL影響とSQLite/D1互換性の検証が必要。
- `src/saved-automatic-seal-queue.js` は保存済み予想のreceipt `detail_json` を更新する。書込不確定時 `pending-readback` として再書込しない意図だが、異常時と再試行時の一連のテストがまだ必要。

## このチャットで実際にGitHubへ保存した変更
1. commit `4e0a1de9907ae02f824daf945b780a355bcc9873`：`tests/saved-automatic-seal-queue-safety.test.mjs` 新規。自動LOCK無効時はDB.prepareや時計を呼ばず `status=disabled`、`sealed=0`、`externalRequests=0` となることを検査。
2. commit `faf55277f5e2730708aec9dacaaf17a9cdecef46`：`tests/saved-automatic-seal-queue-missing-store.test.mjs` 新規。enabled時に必要テーブルが存在しない場合 `seal-store-unavailable`、`retryWrite=false`、`sealed=0`、DB書込0を検査。
3. 本記録を同じ提案ブランチに保存。main・本番への変更は0。

**検証区分：テストコードをコミットしただけで、これらの新テストの実行成功・CI成功は未確認。** 既存の738/742成功はWorkの以前のローカル報告であり、今回の成果として再計上しない。

## 次のWorkが行うべき具体作業
1. ブランチと既存PRの最新head、mainとの差分を取得。先行コミットを消したり新しい重複PRを作ったりしない。
2. 新規テストを含むNodeテスト/CIを実行して結果・失敗箇所を記録。**特に `no such table` の例外文字列とSQLite mockの動作を確認すること。**
3. `scheduledSavedAutomaticSeal` の日付境界・発走5分前・`pending-readback`・既存LOCK・receipt更新失敗・同時実行・D1上限時停止をテストする。必要な箇所のみ修正。
4. `index-v3.49.0.js` のcron実際の呼出しと `enabled` 値、通常予想GETのLOCK readbackを追跡。**未有効化の状態を稼働済みと報告しない。**
5. 発走前の未来48Rについて、番組48/48保存という過去実測と、名簿/正式カード/過去走/通常予想/LOCKの実測を区別する。既存receiptの保存本文を再利用し、空のJRAカードテンプレートは名簿として保存しない。
6. 安全な本番導入が必要になれば、変更ファイル/CI/DDL/DB予算/Worker公開回数を示して個別承認を求める。承認前にマージ・公開・強制取得しない。
7. 本番導入後は未来の1レースで公式カード→履歴→予想DB保存→独立GET/SHA→発走前LOCK→独立LOCK READを確認してから拡大する。テスト成功と本番成功を混同しない。

## 現在の未達・不確実性
- 10/31・11/1名簿・正式カード・過去走の**最新**保存件数はこのチャットでは照会していない。前回Workの07:37時点は番組48/48、名簿0/48、正式0/48だが現在値として断定しない。
- 自動LOCK新規成功0というのは以前の観測であり、今回の本番再測定ではない。
- 今回はGitHubコードの確認とブランチへのテスト追加のみ。本番API GET・直接D1・POST・外部JRA取得・公開は0。
- 提案ブランチは本番に反映されていない。実装完成・動作保証・自動監視中とは報告しない。


## 追加承認方針：出馬表確定前の暫定予想（ユーザー確認、2026-10-26）
- ユーザーは「出馬表確定前でも発走前予想ができるか」を確認し、次の**段階的方針を記録すること**を了承した。これは設計方針の記録であり、暫定予想機能の実装・本番公開承認や成功実績を意味しない。
- **段階A／出走馬未確定：** 特別登録馬など出典・取得時刻が確認できる候補と、保存済み過去走を用いて能力・距離/コース適性を「暫定評価」として表示。候補が全出走馬であるとは主張せず、未確認データは欠測と明記。
- **段階B／出走馬確定・枠順未確定：** 確定した出走馬と利用可能な過去走で全頭を暫定評価。馬番・枠番を推定して埋めず、馬番に依存する買い目や正式LOCKは生成しない。
- **段階C／正式出馬表・枠順確定後：** JRA公式カードの出走馬・馬番・枠番・同一性・保存時刻を検証し、正式なLABO独立予想を保存→独立GET/SHA照合→発走前LOCK→独立LOCK READを行う。
- **履歴保護：** A/Bの評価は各時点の入力、取得時刻、予想生成時刻、モデル版、対象候補集合、欠測情報を保持し、後からの正式カード・結果で過去版を上書きしない。A/Bは「正式予想」「正式LOCK」「学習候補」として計上しない。
- **優先順位：** 10/31・11/1の正式カード→独立予想→正式LOCK完成を最優先。A/Bの追加開発がこの本線を遅らせる場合は延期。保存済み履歴・番組・名簿を再利用し、外部取得やD1追加消費を最小化する。
- **現在の実装制約：** 既存 `prepareSavedAutomaticSealInput` は正式カードと保存済み予想の全馬一致を要求するため、A/Bをそのまま正式LOCKできない。この検証を緩めない。A/Bを実装するなら別ステータス・別保存/読取経路として設計し、実装とテスト後に本番導入の承認を求める。
- **検証条件：** 暫定/正式の表示ラベルが混同されないこと、馬番未確定時の買い目抑止、出走取消・馬名同定・日付跨ぎの扱い、正式版への移行時に旧版を保持すること、発走後の再生成を事前予想と偽らないこと。


## 通常チャット追加実装・再確認（2026-10-26、Work再開前）
- `src/index-v3.49.0.js` を候補ブランチで再確認。importは3・4行目、既存scheduler接続は313行目付近：`env.LAB_SAVED_AUTOMATIC_LOCK==='true'` のときだけ `scheduledSavedAutomaticSeal(db,{enabled:true})` を呼ぶ。したがって「cron未接続」は古い残件記述。**接続コードは存在するが、環境変数の本番設定・実行成功は未確認**。本番有効化を勝手に行わない。
- `tests/saved-automatic-seal-input.test.mjs` の既存テストは、未来日2日・元SHA保持・正式カード変更/結果/締切・既存LOCK保護・原子性・readback不確実時の再書込禁止・GET include_lock・自然schedulerのdisabledなどを既にカバーしている。追加テストが重複している可能性があるためWorkはテストを整理してから増やす。
- `src/saved-automatic-seal-queue.js` の missing-table 判定は元々小文字の `/no such table/` で、D1の例外が大文字表記を返す場合に通常例外として上がり得た。**commit `e9eea8eb9b938a716b9f4128b918a9305c58a21b`** で `/no such table/i` に局所修正。SQL実行数・対象選択・保存条件・既存LOCKには変更なし。
- 先に追加した `tests/saved-automatic-seal-queue-missing-store.test.mjs` は `D1_ERROR: no such table: ...` を再現する。上記修正は大文字の `NO SUCH TABLE` にも対応するが、その追加テストは未作成。新規CI/テスト結果未確認。
- 実施：提案ブランチの1ファイル局所修正、GitHubコミット。未実施：mainマージ、Worker公開、環境変数設定、D1照会/書込、実レースLOCK検証。
- **次のWork最優先：** 提案PRのCI実行結果を取得し、scheduler接続済みという最新事実を前提に、本番有効化前の残る安全条件・DDL・DB消費・未来レースの正式カード/予想保存状況を確認する。未接続として二重実装しない。


## GitHub Actions実測（通常チャット継続確認）
- commit `e9eea8eb9b938a716b9f4128b918a9305c58a21b` に対するPR-triggered GitHub Actions `Node tests` run **40251643053** は `completed/success`。job **121344646795** (`test`) は `completed/success`、`Syntax check active Worker` と `Run test suite` の各stepも `success`。job logsの個別テスト数はまだ未読のため件数を推測しない。
- 取得時の `main...proposal/saved-automatic-lock-readback` 比較は **ahead 7 / behind 0**、変更12ファイル（この時点のheadには直前の本記録更新コミットも含む）。PRブランチのCIであり、main CI・本番Worker・実DB保存・LOCK成功とは区別。
- 本番書込/デプロイ/環境変数変更は今回0。新規の公式カード・名簿・予想・LOCK保存件数も未測定。
- 次の確認：最新headに対応するActionsがあるかを確認し、run/jobとコミットSHAを対応付ける。CIが古いheadの成功なら最新headの成功と混同しない。


## 優先順位順の継続実装（2026-10-26 通常チャット）
- **P0：来週の本番正式カード/名簿/履歴/独立予想**。今回この経路の本番保存件数は測定せず、進捗を推定しない。既存の10/31・11/1 48番組保存という過去観測と混同しない。
- **P1：本番導入候補の自動LOCK安全性**。実装済みの小文字無テーブル判定を大文字にも対応させたcommit `e9eea8eb` の再発防止として、`tests/saved-automatic-seal-queue-missing-store.test.mjs` に **大文字 `D1_ERROR: NO SUCH TABLE`** の回帰テストを追加。commit `5766d98525c0a324df34ffcc7b501a9c8ff4b22a`。対象SQL1回、書込0、`retryWrite=false`、`sealed=0` を検証する内容。**新コミットのCIは未確認**。
- 直前の記録コミット `ecb063e9ff3d7cce8cad729f036b23d70438920f` に対応する `Node tests` run `40251778969` は `completed/success`。この成功を今回追加のテストコミットの成功とはみなさない。
- **残る重要な構造的疑問**：schedulerの候補SELECTは `lab_prospective_seals` の存在を前提とし、保存側の `ensureProspectiveSealTables` は候補が選ばれた後に呼ばれる。表未作成の初回稼働では `seal-store-unavailable` となり、自然に初回LOCKへ進めない可能性がある。**本番で表が既にあるか未確認**。DDLを安易にcron冒頭で実行せず、既存表・本番承認・予算を確認してから局所対応する。
- 次のWorkは本番の既存テーブル有無を最小READで確認できる承認済み経路を検討し、正式カード/独立予想の成立条件を優先して確認。ユーザー承認なく環境変数有効化・新トリガー作成・Worker公開をしない。


## 未作成テーブル問題の実コード追跡（2026-10-26）
1. `scheduledSavedAutomaticSeal` は有効時、最初の候補SELECTで `lab_automatic_predictions_v1`, `jra_race_program`, `lab_automatic_prediction_receipts_v1`, `lab_prospective_seals` を参照する。`lab_prospective_seals` 未作成だと **候補選択自体が失敗**し、後段の`sealSavedAutomaticPrediction`に到達しない。
2. `sealSavedAutomaticPrediction` は先に `readSavedAutomaticSeal` を呼び、正式カード/予想が有効なら `ensureProspectiveSealTables` で `lab_model_locks` と `lab_prospective_seals` を `CREATE TABLE IF NOT EXISTS` する。続いて既存/自動LOCK用トリガーを作成する。**初回候補SELECTとテーブル作成の実行順序が逆**なのが初回起動ブロッカー。DDLは複数実行でD1書込予算・権限・既存テーブル保護に影響する。
3. `readSavedAutomaticSeal` と `includePending` の無テーブルcatchは小文字限定 `/no such table/`。今回のscheduler本体だけは `/no such table/i` に変更済み。読取APIでも大文字のD1エラーが上がり得るが、正式なGETで例外を握り潰すかは別途設計判断が必要。
4. **安全な対応の選択肢**：本番で既存sealテーブルの存在を確認できる場合は現状のまま安全検証を続行。未作成なら、承認済みのマイグレーションで必要なテーブルとトリガーを**一度だけ**作る方法を第一候補とする。cron毎回の無条件DDLは避ける。別案は候補SELECTの `NOT EXISTS` を外し、読取・idempotencyで既存sealを判定するが、余計なSQLや重複処理の恐れがあり、測定とテストなしに採用しない。
5. **確認が必要なこと**：本番D1の`lab_model_locks`/`lab_prospective_seals`の有無とスキーマ、トリガーの有無、現在の環境変数値、既存sealと旧モデルLOCKの件数、実行に使える権限とD1上限。現時点では**実DB未確認**、テーブル未作成は条件付きの障害可能性であり確定障害ではない。
6. `tests/saved-automatic-seal-queue-missing-store.test.mjs` の大文字回帰テストは現在のコードを再確認。最新CI成功は追加テストコミットの成功を意味しない。**未確認の修正を完了扱いしない**。


## 本番DBテーブル存在確認の接続経路調査（2026-10-26）
- GitHub `wrangler.jsonc` を実読。Worker `keiba-lab-api`、D1 binding `DB`、database_name `keiba-lab`、cron `*/3 * * * *` 等を確認。ファイルの `vars` には `LAB_SAVED_AUTOMATIC_LOCK` の設定が見当たらず、**本番環境での変数値を示す証拠ではない**（Dashboard secrets/variables は別管理され得る）。
- この通常チャットの利用可能な接続ツールを探索したが、Cloudflare D1に対する直接の読み取りSQL実行ツールは見つからなかった。GitHubのコード・設定確認はできるが、**本番D1 `sqlite_master` の結果を取得したとは主張できない**。
- 本番DBの`lab_model_locks`/`lab_prospective_seals`の実在・スキーマ・トリガー有無は**未確認**。接続経路なしに未作成と断定せず、CREATE/ALTER/DELETE/本番環境変数変更は一切実施しない。
- Work復活時に、既存の承認済みCloudflare接続で以下の読み取り専用SQLを**1回の照会で**実行する（接続が無い場合はユーザーに承認/接続を依頼）：`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE (type='table' AND name IN ('lab_model_locks','lab_prospective_seals')) OR (type='trigger' AND tbl_name IN ('lab_model_locks','lab_prospective_seals')) ORDER BY type,name;`。結果のテーブル定義・トリガー名を確認してから不足分のみ対処。必要に応じてread quotaを見て延期する。
- 今回は接続確認・実設定の読み取りのみ。DB read/writeは0、実レースへの影響0。



## Work再開・追加修正と本番READ（2026-10-26 13:10 JST）
- 指示を継続し、remote HEAD04b122005c3f81499d80669f1ff2671d7f2a4468と本書、AGENTS/目的/恒久ルール/当日台帳/Issue178最新引継ぎを照合。通常チャット追加のdisabled/missing-storeテスト4件を再利用し、LOCK関連13件成功を実行確認した。既存cron接続を再実装していない。
- 実証した追加欠陥：readSavedAutomaticSealの本体・pending読取の2catchが小文字限定で、D1_ERROR: NO SUCH TABLEで未保存GETが例外になる。追加回帰を修正前に実行して1失敗、case-insensitiveへ2箇所だけ修正して成功。quota/database locked/no such columnは元例外を伝播することも検証。既存uppercaseテストのSQL書込検出regexの余分なescapeも修正した。
- 変更対象src/saved-automatic-seal.js/tests/saved-automatic-seal-queue-missing-store.test.mjs。引継ぎ済みqueue/safety testは保持。新SQL/外部要求/DDL/頻度/採点/LOCK条件変更0。本番未反映。最新全体751/751ローカル成功（既存746+引継ぎ4+今回1）。合成SQLite/mock結果で本番LOCK成功ではない。
- 本番READはbudget→pipeline→coverageの3GETのみ。DOMのJSONoktrueを確認、HTTP数値はこの経路では未測定。budget updated13:07:03.060 JST/UTC10-26/152152read/4422q/unknown0/quotaErrors0/pausedfalse。定期operationのみでaccount/画面/確認GET/bookkeepingを含む余裕とはしない。
- 13:10頃coverageの公式対象48Rを抽出：10/31東京12/京都12、11/1東京12/京都12、番組48/48・名簿0/48・正式カード0/48・暫定予想0/48。APIの非開催新潟24仮想枠は不足数に加算しない。通常正式予想とLOCK累計は当該APIに集計なしで未測定。今回新規保存/独立予想SHA/画面/LOCK確認成功0。
- history最新12:54:51.257〜51.775 JSTはcooldown/acquisition/external0、共有nextBatchAt13:18:56.291 JST。cardSelection内京都10/31 11Rは履歴値で、外部0なので新実取得対象とは報告しない。results13:00cooldown外部0、archive13:06idle外部0。時計だけでgate解除としない。
- 名簿最新実取得は12:00:50.837〜53.385京都10/31 4R、HTTP200/外部1/開催同一性照合拒否/publication-unconfirmed/保存0。1896read/6write/12q/2419ms（名簿operationのみ、全history/accountではない）。東京3Rも11:42同段階停止。本文未読なので京都1の空テンプレートと同じ原因と断定しない。次のsource clock13:00は経過済みでもshared gate/lease/公平dispatcherを満たす自然枠のみ。
- LOCK表・triggerの本番実在は未確認。GitHub/公開APIの既存経路には任意sqlite_master SELECTの実行機能を見つけられず、Cloudflare/D1専用connectorもなし。不存在を決めつけてDDLを前倒ししない。既存queueのseal-store-unavailableはfail-closedとして維持、cron毎回DDL追加0。環境変数の実値も未確認（ブランチ自体未公開）。
- PR283は保存済みJRA共有本文を対象限定1SELECTで読む診断のみ。07:48のPublished-link bound exceeded本文を再取得せず確定するための候補。未マージ/未公開、上限緩和0。次に必要な本番承認はこの3ファイルのマージ/Worker1回であり、PR284のLOCK有効化・trigger作成まで含めない。
- PR284のwriter/6trigger/既存2表利用案は引き続きDraft未公開、環境変数未変更、既存SHA/印/LOCK正本不変。新しい未来名簿が保存されるまでは全馬履歴・通常予想実データ検証へ進めない。取得本文の確定/公開待ちを区別し、推測データで予想を作らない。
