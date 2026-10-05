# KEIBA LABO production verification — 2026-10-05 JST

## Deployment

PR #1 was merged into main with merge commit a59b0aace41416f3c64b7234fcdaca87ce6375bf. GitHub integration deployed the API: both / and /v1/lab/deploy-check return v3.7.1. The build identifier is verified-cards-atomic-prospective-seal. D1 is connected and the source-evidence table exists.

## Verified production ingestion and storage

A published October 4 Tokyo 11R card was fetched and saved through /v1/lab/card-ingest?date=2026-10-04&cursor=22&limit=1.

- Confirmed saved race: 2026-10-04:東京:11.
- Saved runners: 17; distinct runners: 17; invalid runners: 0.
- First/last horse numbers: 1/17.
- Row-level complete: true.
- Official count/source evidence verification: true.
- Audit anomalies: none.
- Saved timestamp: 2026-10-05T05:46:33.969Z.

The source-evidence count uses the actual official horse-name cells in the roster table when an explicit head-count label is absent. Horse/frame numbers are source-observed, not inferred. Source SHA-256, count basis, runner fingerprint and save timestamp are stored.

## Prospective LOCK checks

A request to seal the already-run October 4 race was correctly refused with “past races cannot receive prospective validation credit”. No prospective LOCK was created by that request. Prospective seal tables and immutable/result-time DB guards were created successfully in production.

Two-row atomic saving, mutation/deletion rejection, concurrent-key behavior, source-card changes during prediction and stored SHA-256 verification pass local SQLite SQL tests. Successful future-race sealing and the card-evidence insertion guard still require live D1 verification on the target race.

## Target dates

Production audit for October 10–12:
- Staged programs: 72.
- Graded programs: 4.
- Stored target cards/runners: 0/0.
- All cards complete: false.
- Audit anomalies: none.

A bounded October 10 Kyoto 1R ingestion probe returned card-not-discovered with no source-fetch errors and saved nothing. This does not prove that every target card is unpublished. The JRA meeting selector inspected earlier displayed October 3 and October 4 only. Saudi RC remains unsealed.

## Implementation and tests

The production wrapper now performs exact-date published-link discovery, JRA literal action/POST navigation, source identity and observed runner checks, confirmed target persistence, row-level audit and deployment-version reporting. Source requests time out after 20 seconds.

The hourly cron configuration stages upcoming dates and rotates eight-card batches across up to three race dates, processing two dates per run. The 72-program rotation is covered by tests. A real scheduled production invocation has not yet been separately observed.

`node --test tests/*.test.mjs`: 27 passing tests. The real 17-runner card also passed local SQLite ingestion, row-level audit and source fingerprint checks before the production write.

D1 batch transaction semantics: https://developers.cloudflare.com/d1/worker-api/d1-database/#batch.

## Next

1. Observe the production scheduled collection, and inspect target-card discovery after publication.
2. Run all target cursor batches and require complete actual-row coverage plus current verified source evidence; investigate missing cards.
3. Confirm Saudi RC’s full card and explicit track assumption, run the prediction pipeline, seal before results, and verify saved hash/time and repeated-call behavior.
