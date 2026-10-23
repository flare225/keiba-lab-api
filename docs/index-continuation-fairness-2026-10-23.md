# Continue discovered official indexes without starving rediscovery

## Evidence and cause

PR249 production at Oct23 16:54:49.509–53.499 JST selected Saturday Niigata11: discovery/retry, previousDiscoveryClass=untried, eligibleCards0, discovery64(untried9/retry55), externalRequests1, official-card-index-found, officialCardsCreated=false. Read-only coverage found Saturday Tokyo11/Kyoto12/Niigata11 each holding an index URL, no individual URL; formal cards0/36. The existing retry pick orders next_attempt_at, so older calendar-only receipts precede newly updated index receipts. Candidate selection has progressed, but index parsing/card save has not been demonstrated. No new production observations are implied by this document.

## Scope

Only src/missing-official-cards.js production code changes. Subdivide due retry discovery into (a) a saved, strictly validated JRA published-index URL to continue and (b) other rediscovery receipts. Alternate those groups, choosing oldest due inside each; when one is empty, select the available group. Initial retry opportunity with no stage history favors continuation. Existing PR249 untried/retry alternation and PR248 discovery/card alternation remain. All72 use the same rule; no fixed day/venue override. Urgent12h/witnessed URL exceptions retain their existing selection.

Use isPublishedCardIndex already provided by the existing parser: arbitrary URLs never gain continuation priority. Preserve lastRetryDiscoveryStage in existing cardSelection JSON across direct-card/untried turns and coordinator cooldown. Only existing external-request deliveries update a turn. No schema, writer, coordinator, gate, lease, HTTP403pause, retry deadline, frequency, quota, card validation, prediction/model, SHA or LOCK code changes.

Additional SQL0; new write SQL0; extra external requests/delivery0. Reuse existing receipt card_url and PR248 indexed prior-result read (already1 per selected history invocation). New diagnostic fields add stage+eligible group counts to existing JSON. In-memory filtering/URL parsing and a small JSON payload increase are real but unbenchmarked; production D1 rows/account usage are unmeasured. No extra table or background lane.

## Tests and release boundary

Published PR249 fails four new regressions. Revised code passes full660/660 locally. Six mixed retry turns alternate continuation/rediscovery and visit all3 stored index targets. Inverse opportunity, class persistence across card/untried slots, individual403deadline/shared lease stop, original collector4 metadata queries/turn, and actual default index parser→exact date/venue/R individual URL receipt are exercised. The actual collector test uses one fixture response through its unchanged JRA request builder; it never accesses JRA. It verifies no formal card write and rejects wrong-date/venue/R links. Existing urgent, full72, immutable prediction and LOCK tests remain green.

Draft PR and CI only are authorized. No merge/deploy. The current production cron still runs PR249; a continuation is not guaranteed before this patch is separately approved and published. After publication, when a retry-discovery turn is due and at least one of the three Saturday index receipts remains eligible, continuation should receive an opportunity. Gate/lease/individual wait/urgent work can defer it; a single next cron cannot be promised. Index fetch, individual URL discovery, drawn-card DB save, independent JSON/hash readback, normal prediction and browser must each be observed separately. Parsing/HTTP403/coverage may still block later stages. Preserve PR247/244, model/newLOCK and all Kikka snapshots.
