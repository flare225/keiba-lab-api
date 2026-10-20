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

## 将来レースでのshadow検証（3.49.41）

`/v1/lab/automatic-shadow-validation` は学習と同じoperator Bearer認証が必要。
POSTは `confirm: "VALIDATE"`, `runSha256`, `targets` を指定する。GETは `?sha256=<validationSha256>`。
POSTはlearning読取予算内で処理する。自動実行・取得ジョブは追加しない。

保存済みの学習候補が成立しており、validationFrom以降かつ前日以前のレースだけを許可する。
学習証拠との重複、モデル違い、候補作成以前に保存された事前予想は拒否する。
元の事前特徴量と結果ラベルのハッシュ・全馬対応を検証し、固定した候補重みと基準重みの
レース単位のpairwise concordanceを等加重平均で比較する。
候補のスコアを事前LOCKしたという意味ではなく、事前保存特徴量を使う将来期間のshadow検証である。

10レース・2日未満はawaiting-validation-data。到達後もready-for-reviewに留まり、精度向上確定・
本番反映とは扱わない。元の予想・ユーザーLOCK・凍結実験を変更しない。
記録は別のimmutableテーブルに保存し、内容ハッシュと学習記録との対応を読み返す。
読返し失敗時は保存不確定とし、自動再書込みしない。

2026-10-20の実装検証は合成SQLiteデータのみ。本番データ取得・予想保存・学習・将来検証は各0件。
D1上限に達した同UTC日の本番DB照会は実施しない。
