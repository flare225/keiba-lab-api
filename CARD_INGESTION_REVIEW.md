# KEIBA LABO ingestion and prospective LOCK check — 2026-10-05 JST

Live API: https://keiba-lab-api.sekai-no-bancyou.workers.dev/
Production baseline: 3870800b4e5fcaa6f018ff6285bf835a0d9100ae, v3.7.0.
Configured entry point: src/index-v3.7.0.js. Proposed entry point: src/index-v3.7.1.js.

## Verified live state

D1 is connected. October 10–12 has 72 staged race programs, four graded programs, zero saved cards and zero runners. Prospective scan returns zero strict eligible candidates. The official JRA card meeting selector inspected during this check displayed October 3 and 4; the target future cards were not discovered. No production DB writes or Saudi RC LOCK were performed.

## Fixed in this proposal

- Legacy ingestion ignored requested date/venue/race number, used today's date, and had bootstrap seeds only for October 4. Replace that call with target-specific published-link discovery and confirmed per-target saves.
- JRA navigation uses literal doAction arguments and POST CNAME. Extract the published arguments, submit the documented page form shape, reject parameter-error pages, restrict links to JRA, and skip other dates' meeting selectors. Never synthesize checksums or execute site JavaScript.
- Source horse rows and official roster cells are counted independently from the legacy parser. Preserve observed horse and frame numbers; do not fill missing numbers from row order or derive frames for this ingestion path. Explicit header counts are preferred; when absent, count the horse-name cells in the actual source roster table. Persist count basis, source SHA-256, runner fingerprint and card timestamp.
- Audit actual and distinct saved runner rows, contiguous numbering, invalid names/numbers, orphans, header counts, and evidence freshness. A successful DB inspection is distinct from complete card coverage.
- Bounded eight-card batches expose cursor/nextCursor. Hourly scheduling stages eight upcoming days then rotates up to three race dates, processing at most two dates per invocation. All 72 staged programs are covered by the tested nine-slot rotation.
- Prospective LOCK refuses absent or stale source evidence, zero runners, prediction identity mismatches, or official outcomes. Two seal rows commit in one D1 batch transaction. Existing/concurrently created seals must pass SHA-256 verification. DB triggers reject seal updates/deletes, sealing after results, and source-card changes between prediction and insertion.

## Validation

`node --test tests/*.test.mjs`: 27 passing tests. Tests cover extraction, exact date identity, redirects, duplicate/missing runners, save acknowledgement, partial audit, scheduler coverage, source count/frame checks, transactional rollback, immutable seals, result-time refusal and hash verification.

Live read-only parser check on an already-published October 4 Tokyo race card: official roster cells 17, source rows 17, parsed runners 17, observed horse numbers and all observed frames agree. JRA meeting selector GET returned an HTTP-200 parameter-error page; POST returned the expected meeting selection page. These checks do not verify the future target cards or production D1 writes.

SQLite tests execute actual SQL transactions and triggers through a D1-shaped adapter. Cloudflare's D1 batch transaction semantics are documented at https://developers.cloudflare.com/d1/worker-api/d1-database/#batch. Live D1 validation remains required.

## Remaining

1. Deploy reviewed changes and verify live discovery on the target dates after publication. This draft has not been deployed.
2. Ingest every cursor batch, confirm row-level coverage and source-evidence checks, and investigate any missing cards rather than assuming nonpublication.
3. Run Saudi RC prediction with an explicit track assumption, seal the verified card, then verify the saved hash, timestamp and repeated-call behavior in live D1.

The strict parser deliberately blocks unsupported page layouts rather than inventing source numbers. Add a source-grounded fixture when a future JRA layout differs. Deployment adds evidence-table/trigger definitions; these have been tested locally, not applied to production.

Final pre-merge check: the real 17-runner source card also passed local SQLite persistence, actual-row audit, official roster count verification and exact runner-fingerprint verification. No production DB data was changed by this test. Source requests have a 20-second timeout; /v1/lab/deploy-check reports the new wrapper version.
