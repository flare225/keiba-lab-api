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

### 再開修正CIの実測
- head403abf918a7a12a735bc14a132f213b5dc7905b1のPR検証job121393826190はsuccess。checkout e0bbb06（head403abf9とmain05dcb83の検証merge）、ログでtests751/pass751/fail0を確認した。mainマージやWorker公開ではない。Issue178 comment6408043104へ実作業差分を記録済み。


## 14:02 PR283承認公開・実JRA本文の上限停止確定と局所修正
- ユーザー承認をPR283の3file49add/head12232fd49990825bbe29c0d16e720c1ec097443c・Worker1回へ限定適用。CI739/739をログ照合しmerge211d911ee7531149dac5686fd4cc244ebbea7970。公開40272096259/job121406910243 success、exactmerge checkout/公開直前739成功、14:02:32.710 JST Worker9829a8a1-58aa-442c-b56d-34a4e6a6887c。14:02:48.077 deploy-check ok/version3.49.63/release-identity-only/databaseVerifiedfalse。承認1回使用済み、PR284/LOCK有効化/DDL/モデル変更/追加公開なし。
- 本番READはbudget1/当該保存本文診断1/pipeline1の計3。DOM JSONoktrue、今回GETのHTTP数値は未測定。budget UTC10/26/updated14:01:08.837 JST、184827read/5385q/unknown0/quotaErrors0/pausedfalse（account/手動/画面/台帳を含まず）。
- scope10/31・保存済みpw01d5000A4/F9の全文を読取。APIavailable/integrityVerifiedtrue、復号HTML111855UTF8bytes、保存SHA9b7d55553daf74ecfcdf136c9dd7463c1a8c69f86d603b012ed840d85dcd9b06。元応答HTTP200、受信108060bytes、復号shift_jis、observed07:48:52.999 JST。APIが全文再hash、ブラウザ評価ではcrypto.subtle未提供でclient別再hashは未完了（再GETせず）。原HTTPbytesのSHAとは別。2read/0write/1q/281ms、外部0。
- 確定原因：CSS/一般nav/profile/結果等207を含む全282リンクへ256上限を先に適用していた。canonical許可対象は75（30cards/45pages）。取得対象外のリンクで共有parserを停止させていた。正式カード未公開と同一視しない。
- 別の制約：実本文タイトル『今週の出走馬一覧（50音順）』、個別30リンクの日付は全て10/24・25。scope10/31で保存されても本文内容が来週対象とは限らない。この修正だけで未来名簿取得が保証されるとはしない。既存日付/場/R一致判定を維持、前週カード/結果を未来予想へ混入しない。元HTML全文は再配布せず、抽出された282URL集合だけfixtureへ保存（元本文/SHAを再現したとは言わない）。
- local094a752/remote8d15de8b1c42891183464af9764a78756ffdcdac、Draft PR285 https://github.com/flare225/keiba-lab-api/pull/285 、5file39add7del：src/shared-page-acquisition.js、src/shared-page-evidence.js、tests/shared-page-acquisition.test.mjs、tests/shared-page-evidence.test.mjs、tests/fixtures/jra-shared-links-20261026.json。
- 既存256上限をunique canonical取得対象へ適用。parserVersionをshared-page-v2-supported-linksへ変更し、既存失敗本文を取得せず再解析可能にする。SQL文/DDL/外部枠/頻度/ゲート/403pause/lease/予算/予想/LOCK不変。旧版の解析済みnavigationも対象選択時に保存本文の再解析となるため既存READ/receipt更新負荷は発生するが、新しいSQL文やHTTP枠は追加しない。保存済み正式カードは完了除外を維持。本番D1量/削減率未測定。
- 実本文由来URL集合で修正前Published-link bound exceededを再現→修正後45pages/30cards。旧parse-failedを追加HTTP0で再解析、保存本文とSHA不変、formal/forecast保存0、未来対象に前週カードを選ばないことを確認。257許可対象は引続き拒否。ローカル741/741、PR CIjob121408256023のログで741/741・fail0成功（対象head8d15de8、現main211d911の検証merge）。本番取得成功とは区別。
- 公開後最新自然history14:06:49.490〜49.733 JST cooldown/acquisition/外部0/共有nextBatchAt14:48:57.519 JST。直近公開戻り値だけではゲート延長元HTTP/receipt不明、403と推測しない。時刻だけで解除としない。coverageは今回は再GETせず、最新全体件数は13:10の前報（番組48/48、名簿/正式/暫定各0/48）。今回カード/通常予想/LOCKの新規保存確認0、予想独立SHA/画面新規0。
- 必要な次承認はPR285のマージ/Worker1回のみ。今回のPR283承認を拡大しない。公開後は自然担当の保存本文再解析（HTTP0）→対象日リンク→公開済み名簿/カード保存→独立GETを工程別に確認する。PR284の本番表/trigger/環境変数は未確認・未導入で、LOCK有効化とは別承認。Issue178 comment6408681865へ途中実測を記録済み。


## 14:11 PR285承認公開・公開後の検証条件
- 最新ユーザー条件付き承認をPR285のhead8d15de8b1c42891183464af9764a78756ffdcdac/5file39add7delに限定適用。最終diffはshared-page-acquisitionのcanonicalリンク境界+parser版、shared-page-evidenceの同じ境界表示、2既存testと実URL集合fixtureのみ。CIjob121408256023で検証merge32f8e2b/741pass0failを再読してmerge3881facd183aa44813f3b19eb81b601481b92a1d。本番のゲート/403待機/lease/SQL文/取得枠/schema/採点/予想/LOCK変更0。
- 公開Actions40272873178/job121409297769 success、exactmerge checkout・公開直前741/741success。2026-10-26 14:11:39.692 JST Worker3d47b835-3f65-4d56-b698-2e7f397489ba、14:11:55.052 deploy-check oktrue/version3.49.63/scope release-identity-only/databaseVerifiedfalse。main NodeCI40272873149 success。承認の公開1回使用済み、手動workflow/再公開0。PR284とLOCK用env/triggerは未導入のまま。
- 保存済み実HTML全文（既にブラウザへ読み込み済み、追加GET0）で抽出と新境界を読取専用再現。全282→canonical75、pages45/cards30、cards10/24=16・10/25=14・未来対象0。元保存SHA9b7d55553daf74ecfcdf136c9dd7463c1a8c69f86d603b012ed840d85dcd9b06。これはブラウザ内の解析再現で、自然cronによる再解析receipt保存・正式カードDB保存ではない。元本文/SHA/予想/LOCKに変更0。
- 公開後READはbudget1→pipeline1→coverage1の3回。JSONoktrue、今回HTTP数値はDOM読取で未測定。budget UTC10/26、updated14:06:57.262 JST、186106read/5455query/unknown0/quotaErrors0/pausedfalse。account/手動/画面/台帳量は未測定、内部量から全体余裕を断定しない。
- pipeline checked14:12:43.155 JST、latesthistory14:06:49.490〜49.733は公開前cooldown/acquisition/external0/next14:48:57.519 JST。新Workerの自然history起動は未観測。cardSelection京都11は過去履歴で今回実取得ではない。共有gateはcached再解析より先に確認する既存コードなので、保存本文だけでもこの待機を迂回しない。次回担当がhistoryとなる時刻は公平dispatcherに依存し、期限到来だけで再開/成功としない。
- coverage14:13頃の公式48Rは10/31東京12/京都12・11/1東京12/京都12の番組48/48、各場の名簿/正式カード/暫定予想は全て0/12、合計各0/48。非開催新潟の24仮想slotは除外。通常正式予想/LOCK全体件数はAPI集計なしで未測定。今回新規カード/通常予想/LOCK保存確認0、予想独立GET/SHA新規0、browser一致新規0。前週正式カードを今週の成果へ加算しない。
- 追加で得た既存source記録：13:30:51.219〜53.784（PR285公開前）、東京10/31 4R、sourcehttps://race.netkeiba.com/race/shutuba.html?race_id=202605041004、netkeiba HTTP400/external1/statusfetch-failed/saveMayHaveSucceededfalse。1898read/5write/11q/2390msは名簿operationのみ。nextAttempt14:30:51.394 JST、共有gate14:48とは別。HTTP200の同一性照合拒否やJRA403とは混同しない。source最新13:48はsource-not-due/外部0。14:00通常no-due-registered-roster・比較no-due-comparisonは公開前でPR285効果ではない。
- 停止工程：新公開の自然取得担当がまだ未実行、取得系全体はsharedcooldown。既存全文の解析修正は実証済みだが、それが未来対象URL/名簿公開へ到達するか未実証。正式カード/全馬履歴がないまま架空評価やLOCKを保存しない。既存LOCKへの原子接続案PR284は今回の公開範囲外、正式予想保存とLOCKは別扱い。
- 次の具体的確認：shared期限後の自然historyでparserVersion/reusedBody/externalRequests/sourceURL/対象日/エラー/保存件数を取得。成功した新対象だけカードGET・全馬/取消・runnerSHA→通常予想GET/SHA→既存認可LOCK状態→画面を確認。新規0ならURL公開/選択/取得/同一性/保存の停止工程を記録する。連続poll/強制取得/POST/直接D1/追加公開は実施しない。
- Issue178 comment6408762039へ承認範囲/公開ID/本番未達/残条件を記録。現時点で本番機能完成とは報告しない。

## 2026-10-26 14:37 JST — 公開前準備の接続修正、PR286/API・PR110/UI（未公開）
- 指示：正式出馬表0を障害と即断せず、登録/想定/確定枠順前/正式を分離。ローカル修正・テスト・GitHub記録は承認済み、新規merge/Worker/Vercel/DDL/LOCK有効化は未承認。
- 公式公開状況を確認：JRA天皇賞秋 https://www.jra.go.jp/keiba/g1/akiten/syutsuba.html とファンタジーS https://www.jra.go.jp/keiba/race/098/syutsuba.html は10/29(木)公開予定を実表示。通常出馬表の公開ルール https://jra.jp/faq/pop02/2_2.html は木曜16時以降の枠順前、前日10時以降の番号付き（一部例外）。これだけで48Rすべての個別公開状態を断定しない。予定番組は正式カードではない。
- JRA特別登録 https://www.jra.go.jp/keiba/tokubetsu/ に天皇賞秋PDF https://www.jra.go.jp/keiba/tokubetsu/pdf/2026/akiten.pdf の実リンクあり。PDF全登録馬本文は今回読取できず、全頭照合未実施。https://www.jra.go.jp/keiba/g1/akiten/horse.html は選抜候補の紹介であり全登録馬名簿ではない。紹介本文から全馬名簿や数値評価を捏造しない。
- 確定原因：shared-page-acquisitionのpredraw分岐はparseConfirmedPredrawで本文を解析してreceiptに記録するだけで、既存saveConfirmedPredrawを呼ばずlab_confirmed_predraw_rosters/履歴bridge/暫定予想へ渡らなかった。既存テストを延長し旧コードのstored=null失敗を再現、既存writer再利用で修正。外部HTML未公開とこのコード不具合は別問題。
- API Draft https://github.com/flare225/keiba-lab-api/pull/286 head cd054b68a2d7a695a76a06480658ecbe03068a9c、基点ec17fcecb848d7b915b12bd8a55fa796b8f2016c、12file83add32del。ローカル8e9c5f5+8727af8。
- API変更file：src/shared-page-acquisition.js、src/confirmed-predraw-roster.js、src/confirmed-predraw-history-source.js、src/provisional-expected-prediction.js、src/provisional-prediction-snapshots.js、src/provisional-prediction-queue.js、src/index-v3.49.0.js、src/provisional-coverage.js、src/evidence-evaluation-queue.js、tests/shared-page-acquisition.test.mjs、tests/provisional-expected-prediction.test.mjs、tests/provisional-prediction-snapshots.test.mjs。
- 既存predraw保存を共有取得へ接続、元HTML観測時刻を保持、独立DBreadback。同じ毎時枠で既存登録馬+検証済みJRA枠順前名簿を評価。暫定のphase/provenance/完全性を保存。stage2はrace_key:predraw:sourceSHAで別保存、stage1旧SHA時刻を保持。既存GETはstage2優先、basis/source_sha256指定でexact版を読取、pending回収もexact版。coverageは既存rows再利用。旧shadowキューはpredraw suffixを除外して誤参照を防止（採点・モデルは変更なし）。
- stage1「暫定評価・出走未確定」candidateSetComplete=null、stage2「暫定予想・枠順未確定」は検証済みJRA全頭名簿のみ。両者formalLockEligible=false/learning=false、馬枠番null。正式カード・正式予想・既存LOCK検証は緩和しない。通常独立予想完成とは別扱い。
- UI Draft https://github.com/flare225/keiba-lab-apl/pull/110 head5bd375d1c0bcd9ec71cbc7c1962273ae29b53c44、2file7add2del：src/provisional-prediction-view.js、tests/provisional-prediction-view.test.mjs。ローカルef5051b。段階/未確定/候補網羅性不明を表示。新GET・poll・writer追加0、旧APIは出走未確定表示へfallback。印・順位・SHA検証は維持。
- APIローカル743/743、CI job121415447992で743/743成功（head cd054b68を基点ec17fceへmergeした53e038b）。UIローカル201/201、CI run40274958301/job121415632915で201/201、印関連run40274958326/job121415633132で63/63成功。両UIjob checkout dc74a18（head5bd375dをmain622dc162へmerge）。diagnose skippedは既存branch条件。Vercel preview成功は本番公開ではない。
- 実データ/合成を区別：今回の一貫保存→毎時評価→独立GET/SHA/旧版保持/更新拒否/誤版拒否は隔離SQLite・合成馬データ。保存済みJRA実HTMLは前回確認の旧週30カード/許可75リンクであり、未来の実名簿ではない。本番未来名簿・暫定評価・正式予想・LOCK・画面の新規保存成功を証明していない。
- 負荷：confirmed名簿候補に索引付き範囲LIMIT120 SELECTが毎時1件追加。predraw保存成功時は既存CREATE IF NOT EXISTS1/既存projection INSERT1/独立READ1の3SQLが旧parse-onlyから増える（新table/schema定義追加はないが既存table未作成時DDLが到達するため公開承認が必要）。予想snapshotは既存append-only表へ新規別版保存。default GETはSQL1のままlegacyPK+predrawPK範囲の2索引探索、版数によって読取増加あり。本番rowsRead/rowsWritten・account全体未測定。外部HTTP増加0、共有gate/403cooldown/lease/取得頻度/毎時max1/既存採点は不変。parserVersion v3は保存済みbody再解析を可能にするがD1実測は公開後に必要。
- 今回本番GET/POST/直接D1/外部強制取得/merge/deploy/env変更0。14:13基準program48/roster0/formal0/provisional0は前回値で最新値へ流用しない。最新自然historyと予想/LOCK累計は今回未測定。gate前回14:48:57.519JST、時計のみで解除扱いしない。
- 未解決：特別登録PDF/accessT等を自動名簿化する共通経路は今回追加していない。登録候補実データが揃わなければstage1入力は増えない。正式カード/履歴がないまま架空評価を保存しない。LOCK284は別未公開、本番lab_model_locks/lab_prospective_seals/trigger存在とLAB_SAVED_AUTOMATIC_LOCK設定は未確認でCREATE/変更しない。
- 次の作業：承認対象はAPI286の12file・Worker1回とUI110の2file・Vercel1回（現段階未承認）。自然historyで既存保存bodyの解析→predraw既存store保存→履歴補完→毎時暫定snapshotの別版保存→basis/sourceSHA指定独立GET/SHA→通常UIを段階別に確認。正式公開後は既存正式カード/通常予想経路を使い、LOCKは別の正当条件を確認。PR284/モデル切替/新LOCKの同時公開は含めない。

## 2026-10-26 15時台 — PR286/API・PR110/UIの明示承認公開
- ユーザー最新指示「天皇賞・秋は木曜日に枠順確定するから想定出馬表のみ…そこも踏まえて作業承認」。API286/12fileとUI110/2file、各1回公開の承認として実施。天皇賞秋は木曜確定前の想定/登録段階として扱い、正式カード0を障害や未達と即断しない。登録/確定枠順前/正式を分離、暫定LOCK禁止を維持。
- 最終照合：API head cd054b68a2d7a695a76a06480658ecbe03068a9c/12file、CI743/743、UI head5bd375d1c0bcd9ec71cbc7c1962273ae29b53c44/2file、CI201/201+63/63一致。差分は前項記録どおり。ready化後expected_head_sha指定でmerge。
- API merge70cc1be4996d29ba2d2348c9c0ec3c4b5802dbb3。既存push公開Actions40277163065/job121422248197 success、公開直前743/743/fail0。2026-10-26 14:59:08.392JST Worker49b9da63-99f3-4a19-9de4-38b2ea7b3642、14:59:23.809 deploy-check oktrue/version3.49.63/scope release-identity-only/databaseVerifiedfalse。追加手動起動・追加deployなし。
- UI mergee26b97db5a88bb920e95ef1d6068096b09c8b3f3。Git連携production dpl_AfEDdR2RaotxUmcsyTYwhHuLDtmZ READY、14:58:51.739JST ready（build開始14:58:45.476）。Vercelmeta main+mergeSHA一致、production alias keiba-lab-apl.vercel.app。UI公開は今回1回のみ、追加create/promoteなし。
- 許可済みBrowser診断GET：scheduled-read-budget1、pipeline-status1、provisional-coverage1。上流強制取得/POST/直接D1/LOCK変更/モデル変更/新LOCKwriter公開0。
- budgetは14:55:10.512JST更新の実測値：UTC10/26、213738read/6131query/unknown0/quotaErrors0/pausedfalse、collection209109/learning4629。これは予定処理/認可学習の観測範囲のみ、account全体・画面/手動GET/台帳を含まない。新公開より前の予算値なのでPR286単体性能にしない。
- 14:59:45.419JST pipeline最新historyは公開前14:42:49.340〜49.521、cooldown/external0/next14:48:57.519、historyWorkStageacquisition、targetOct31京都11/eligibleCards8/discovery27(untried6/retry21/continuation6/reexploration15)/shared24。古い期限経過だけで解除・停止・新修正失敗と判断しない。archive14:54awaiting-published-card-links/external0、results14:48cooldown/external0も公開前。
- 公開直後coverageは既定3場72slotを返すが、対象は東京/京都48Rのみfilterして集計：Oct31Tokyo/Kyoto各program12・roster0・正式0・provisional0、Nov1Tokyo/Kyotoも同じ。合計program48/48・名簿0/48・正式0/48・暫定0/48。非開催新潟24slotのprogram-missingを不足対象に加算しない。通常正式予想・LOCK累計はmetadata未集計につき未測定。新規snapshot/独立GET/SHA/browser/LOCK成功加算0。
- coverage最新14時通常no-due-registered-rosterは公開前（31read1write7q1334ms）、比較no-due-comparison7read1write8q1572msも公開前。PR286の追加候補SELECTを実行した証拠ではない。source最新13:48source-not-due/external0/1read0write4q714msは既報で新成果に数えない。
- 公開成功と本番予想準備成功は別。次の公開後自然history/毎時15時評価で新parserとpredraw保存経路の到達を確認する。入力が未公開/未保存なら予想を捏造しない。正式カード前に特別登録/想定名簿の出典検証を進め、正式公開後は既存正式予想経路へ渡す。LOCK284/スキーマ/環境フラグ変更は今回の公開に含めない。

- 公開後の自然実行を15:01:20.761JST pipeline再読取で確認。history15:00:49.380〜52.211 acquisition、実外部targetOct31京都5/補助netkeiba/external1/HTTP400/fetch-failed/saveMayHaveSucceededfalse/次16:00:50.343JST。選択診断cardSelectionはOct31京都11/shared-page-deadlineのまま、実外部targetとは別（選択候補を取得成功としない）。gate期限後の実外部1はその枠の許可を証明するが、最新sharednextBatchAt自体はこの返却にない。403解消や未来カード未公開の証拠とはしない。新body/card/predraw保存0、強制retryなし。
- 当該sourceoperationだけ1900read/5write/11q/1739ms、うち候補結合1880read。writeはreceipt/clock/gate等で名簿5件ではない。account全体と混同しない。既存HTTP400を解析緩和で保存しない。本文は新失敗応答に未収録、根拠なく未公開と断定しない。
- 15時通常暫定自然run provisional-prediction:1792994403213/trigger scheduled、15:00:05.083〜05.741、no-due-registered-roster/external0、新保存0。32read/1write/8q/582ms。新SQL SELECT * FROM lab_confirmed_predraw_rosters WHERE race_key>=? AND race_key<? ORDER BY race_key LIMIT120 が1read/0writeで実行されたため新接続の本番到達は証明。候補名簿は0なので評価保存成功とはしない。旧14時31read/7qから追加1read/1qだが入力/時刻条件が異なり全体削減率を主張しない。
- 15時比較evidence-evaluation:1792994403213は15:00:05.950〜06.564/no-due-comparison/external0、新保存0、7read1write8q534ms。instr(race_key,':predraw:')除外SQLも実行確認。shadow昇格なし。
- 自然枠後coverage再読取1回：対象東京/京都の土日各12R、program各12/roster0/provisional0のまま。名簿0/48・正式カード0/48・暫定0/48、新規独立GET/SHA0/browser0/LOCK成功加算0。正式カード0は現時点の公開段階と取得状況を分ける。通常正式予想/LOCK累計未測定。今回diagnosticGET合計5（budget1/pipeline2/coverage2）、同応答のDOM集計は再GETなし。数値HTTPstatusは上流receiptの400、BrowserGETのHTTP数値自体は未測定(JSONok)。
- 残停止工程：候補入力が未保存で評価キューに評価対象なし。JRA登録PDF全頭の照合と共通登録入力経路は未完了。今回の公開で「確定枠順前名簿が保存された後に評価へ渡らない」接続欠陥を修正したが、現時点でその実名簿取得/保存成功は0。木曜前の登録・想定入力整備と、保存済みJRA本文の次自然解析結果を優先して追う。無効本文を正規名簿扱いしない。LOCK284は引き続き未公開・未有効化確認で、暫定LOCKは行わない。

## 2026-10-26 15時台 — 京都Oct31 5R HTTP400の原因切分け・非2xx証拠欠落修正（未公開）
- 指示：想定/登録馬の取得・DB保存を最優先、京都5Rの要求生成/取得先/応答本文/保存判定を既存証拠で切り分ける。正式予想/LOCK条件・既存データ・gate/D1を変更しない。調査/局所修正/記録は承認済み、新しいmerge/deployは未承認。
- 最新main d38e98526c856d3c0b3da5b6510673012d47c104、公開runtime70cc1be/Worker49b9da63…、API286/UI110は公開済み。AGENTS・日次台帳・直前Issue178 comment6409364260を引継ぎ、PR285/286を再実装していない。
- 予定読取をbudget1+単一source-evidence1に限定。budget UTC10/26・更新15:00:59.867JST・218814read/6391q/unknown0/quotaErrors0/pausedfalse（collection213402/learning5412）。account全体/手動画面/台帳含まず、余裕の断定はしない。
- 実データ独立READ：GET /v1/lab/missing-roster-evidence?confirm=READ_STORED_SOURCE&date=2026-10-31&venue=京都&race_no=5&include_body=1。JSONok/availabletrue/statusfetch-failed/httpStatus400/source https://race.netkeiba.com/race/shutuba.html?race_id=202608041005、observedAtnull/bodyAvailablefalse/bodySha256null/charsetRecordedfalse/finalResponseUrlRecordedfalse、next16:00:50.343JST。READ2rows/0write/1q/169ms、外部要求0。DOM読取はAPI自身のHTTP数値を実測した意味ではない。
- 停止工程は上流HTTP取得：15:00自然cronがGET1回でHTTP400を受信→response.ok=falseでthrow→名簿parser/saveExpectedRosterに未到達。保存判定の緩和や馬名/番号推測は行わない。これは正式出馬表未公開とは別の失敗状態。
- リクエストコード：supplementaryRosterUrlはprogramのyear+場code+meeting_no+day_no+race_noを連結。記録URLのIDは2026/08/04/10/05、GET（method省略のFetch既定）/redirectmanual/accepttext/html/timeout10s。URL文字列の形式はコードと一致するが、実URLが当該サイトで公開済みの正しい対象かは応答本文不在のため未証明。勝手にURL/UA/headers/redirectを変更して回避しない。
- 確定した実装欠陥：!response.ok分岐が本文を読み取る前にthrowし、catchの旧UPSERTもstatus/next/url/http/errorだけ保存。400の本文/文字コード/実応答URL/観測時刻を廃棄していた。このため既存ログから「未公開・不正要求・ページ/サイト側拒否」の根本分類は不可能。公開前データ不存在とは断定しない。応答本文は後から復元できず、強制再取得もしない。
- 局所修正：非2xxの自然応答を先頭raw64KiBまでbounded streamで読取り、既存失敗UPSERT1回に本文/decoded本文SHA/観測時刻を保持。既存error欄にversion付きmetadata（要求URL/GET/manual、応答URLが取得できた場合、content-type/選択charset/headerorfallback、完全/部分、上限/読取bytes、読取エラー）を保持。READは従来の人向けerrorを維持しresponseEvidenceを返す。既存同一SELECTからprogramIdentity/expectedUrl/sourceUrlMatchesを本文なしでも返す。元HTML全体/元受信bytesSHAを再計算したとは呼ばず、部分時はbodyCompletefalse。非2xx本文を名簿parserへ渡さない。
- 変更3file40add5del：src/missing-roster-acquisition.js、src/missing-roster-evidence.js、tests/missing-roster-evidence.test.mjs。ローカルcommitfad462f、remote53d1eb56fbbe7c3d609ddc72bf47ce2af8d50800、Draft https://github.com/flare225/keiba-lab-api/pull/287（未merge/未公開）。
- 旧コードで非2xx本文の独立READがundefinedとなる既存失敗を再現→修正後、隔離SQLiteで400本文保存/独立READ/SHA一致・名簿0・追加取得0、64KiB上限/部分明示、403の共有1時間待機維持を確認。既存成功名簿/対象不一致拒否/INSERT不明回収/redirectmanualも維持。局所11/11、全体745/745成功。これらは合成本文、実HTTP400本文の解析成功でも本番名簿保存成功でもない。
- 負荷：外部要求回数0増/SQL件数0増/新schema0。既存失敗UPSERTのpayloadが最大raw64KiB（decodedUTF8は最大約192KiB）+小metadata増える。D1物理書込rows/容量は増加し得る、本番未測定。既存tableは各race最新receiptなので全失敗版の不変アーカイブではない。1時間枠/共有gate/lease/403429503pause/予定制限/正式カード検証/予想/LOCKは不変。
- GitHub作成途中：update_refは未作成branchに422を返したため変更なし、create_branchで保存済みcommitから作成してDraft287成功。認証迂回/forcepush/merge/deploy0。
- 本番の新規想定名簿/正式カード/予想/LOCK保存成功加算0、今回は失敗receipt独立READ1件のみで名簿の独立READ成功とは数えない。48R累計の再照会は省略し、前回15:01のprogram48/名簿0/正式0/暫定0を最新値と呼ばない。JRA特別登録全頭の共通取込経路も依然未完了、正式公開待ちとは別に扱う。
- 次工程：PR287のCI/最終差分を確認してWorker公開1回の承認が必要。公開後、既存の自然枠で得た応答だけを保存し、source-evidence単一READで本文/SHA/要求URLと番組一致/公開表示/対象馬一覧を検証。正しい名簿が実在した場合のみ既存saveExpectedRoster→独立READへ進める。誤応答・非公開ページは保存名簿に昇格しない。既存成功データの再取得・新LOCK・モデル変更・未承認公開は行わない。

- CI実測：PR287 head53d1eb56…、job121425951008 success、checkout d46b2bb（53d1eb56をd38e985へmerge）、tests745/pass745/fail0。PR最終差分3file40add5del/head一致。マージ/公開は未実施。
