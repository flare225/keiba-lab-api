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
