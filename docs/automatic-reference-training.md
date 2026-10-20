# 独立自動予想の結果候補を使うshadow学習

## 接続対象

自動事前予想 `lab_automatic_predictions_v1` → 公式結果ラベル `lab_automatic_learning_candidates_v1` → 新しい `lab_automatic_shadow_training_v1`。

PR179のユーザーLOCK参照学習とはcohortも保存先も分離する。PR179と同じ特徴量・重み候補・正則化・レース単位のpairwise concordance計算を共通関数として再利用する。既存の秋華賞第1版・富士S・frozen実験・本番予想の重みは変更しない。

## 操作と条件

`/v1/lab/automatic-shadow-training` は、既存のUSER_MARK_WRITE_TOKENによるoperator Bearer認証を必要とする。トークンをブラウザやチャットへ渡さない。

- GET `?sha256=<学習記録ハッシュ>`：1件の保存内容とハッシュを照合して返す。該当テーブル/記録がなければavailable:false。
- POST：confirm:TRAIN、targets:1〜100R、trainingThrough、validationFromを指定する。本文16KiB以内。入力不備はD1アクセス前に拒否する。
- trainingThroughは実行日の前日以前、validationFromは実行日の翌日以降。対象は学習期間内・重複なし、モデルが同一であること。
- 30R・2日未満はstatus:awaiting-training-data、candidate:null、remainingRacesを保存する。これを学習済みと報告しない。
- 条件を満たした場合だけstatus:fitted-shadow-onlyと候補重みを保存する。学習期間内スコアは将来精度ではない。
- 将来検証は別途10R・2日を要し、canReviewCandidate:falseを維持する。この実装で検証完了・本番昇格を認める経路は追加していない。

例：実行日が10/26で、検証済み候補がある場合に限り、trainingThrough:2026-10-25、validationFrom:2026-10-27を指定できる。現在そのデータがあると主張する例ではない。

## 保存の根拠

元予想のSHA・公式発走前の保存時刻とJRA番組、結果候補のSHA/予想への対応、全馬の馬番/馬名/スコア/順位/印/特徴量を再照合する。現在の過去走から特徴量を再計算しない。元予想がない、候補が未検証、モデル/出典cohort/対象/期間が異なるものを混ぜない。

記録はSHAをキーにINSERT OR IGNOREし、独立読返し・内容一致後に成功を返す。同じ対象群の順番を変えても同一記録。保存時刻は初回のcreated_atとして保持する。UPDATE/DELETEは禁止。読み返し不確定はsaveMayHaveSucceeded:true / retryWrite:false。

POSTは既存のlearning読取予算内で処理する。残量不明・上限・learning予算停止では実行しない。D1上限による停止でも不確定保存フラグを落とさない。定期処理全体の予算はアカウント全体の利用量ではない。

## 今回の確認

SQLiteの検証用データで30R/2日の学習・保存/独立読返し・不変性・同一入力の重複保存防止・不足時未学習・改変/モデル混在/期間/認証拒否・保存後読返し失敗を確認。実際の本番データ取得、学習、精度改善、本番採用を行ったものではない。
