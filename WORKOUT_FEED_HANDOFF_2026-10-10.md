# KEIBA LABO 追い切り取得・反映 ハンドオフ (2026-10-10)

## 完成した部分
- v3.49.0: `GET /v1/lab/workouts?date=YYYY-MM-DD&venue=東京&race_no=11`
- 公式出馬表（`jra_races` / `jra_runners`）と馬番・馬名を照合し、許諾済みの坂路／ウッド等の計時を日時・コース・出典付きで別テーブルに保存する処理
- `POST /v1/lab/workouts/sync` (認証・明示許諾・確認 `confirm=SYNC` 必須)
- データなしは `stage=not-collected` と明示。取得済み頭数・件数も返却
- `modelIncorporated:false`: 追い切りの評価点・モデル学習・事前LOCKへはまだ一切加算しない

## 公開 / デプロイ
- ソースコードを GitHub main へマージするだけでは Cloudflare Workers 本番が更新されないことを検証済み。
- `.github/workflows/publish-worker.yml` で Cloudflare への配信を追加。
- GitHub リポジトリ Secrets に管理者が `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` を登録した場合のみ実行。未設定のときはスキップして警告。
- `workflow_dispatch` で再実行できる。Worker が `/v1/lab/workouts` と `/v1/lab/deploy-check` で v3.49.0 を返すことを本番で確認する。

## 許諾済み供給元の接続 (実データ自動取得は未稼働)
Cloudflare Worker の Secrets / Variables に次を設定する。
- `WORKOUT_LICENSE_CONFIRMED=yes`: 実際の適法なデータ利用許諾を確認できた場合に限る
- `WORKOUT_FEED_URL`: 権利者または正式な契約先の HTTPS JSON エンドポイント
- `WORKOUT_FEED_TOKEN`: 供給元発行のトークン
- `WORKOUT_SYNC_TOKEN`: LABO 同期操作用の別トークン

許諾・供給元・配信方式が未確定なら、**自動取得を稼働させない**。JRA-VAN DataLab. の個人契約データをアプリに再配信する権利は個人契約に含まれない場合がある。利用規約を確認する。

データ供給元が返す形（以下の数値は単体テスト用の架空データ）:

```json
{
  "rightsGranted": true,
  "sourceName": "Licensed Data Provider",
  "sourceRecordId": "example-123",
  "workouts": [
    {
      "horseNo": 1,
      "horseName": "テスト馬",
      "workoutDate": "2026-10-08",
      "course": "坂路",
      "sessionId": "main",
      "fourF": 52.1,
      "lastF": 12.8
    }
  ]
}
```

保存前に、公式出馬表の馬名・馬番、レース前42日以内・当日以降除外、時計の妥当性、重複、出典を照合する。

## 次の開発工程
1. Cloudflare Worker 本番への正式なデプロイと GET 監査。
2. 許諾を確認した調教データ供給元の接続、まずサウジRC・アイルランドTの取得状況と証拠を確認。
3. 追い切りデータの品質・公開時刻・欠損率を監査。
4. 追い切り評価指標を既存スコアとは独立した shadow-only 検証に追加。
5. 過去レースのブラインド検証で有用性を確認してから、ユーザー合意のもと既存指数への組込を判断する。
