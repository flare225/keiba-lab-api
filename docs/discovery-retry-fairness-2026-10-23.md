# Discovery-internal fairness after PR248

## Fresh production evidence

At 15:24:49.763–55.833 JST on Oct23, scheduled history chose Sunday Kyoto4. cardSelection: lane=card, previousLane=discovery, reason=alternate-eligible-cohorts, eligibleCards=1, eligibleDiscovery=63. The previous observed 15:06 turn was discovery of the same race's individual URL. This demonstrates PR248's cohort alternation, not Saturday progress. One external request saved confirmed-predraw16, officialCardsCreated=false, predictionRebuilt=false. HTTP numerical status and lease internals are not returned. No new403 in this observed job, not proof of a clean whole period.

Metadata: roster28→29/72, provisional24 unchanged; Saturday formal0/36 unchanged. All36 Saturday programs and official-program receipts exist and are due, with calendar sources/no individual URL. Shared gate nextBatchAt=15:25:55.619 JST, as observed by the missing-card GET. Clock passage does not prove release. The new predraw body has no usable public independent readback through the current expected-runners resolver; PR247 is unmerged. Its HTML source hash is not a saved JSON snapshot hash. Do not claim independent16-body/SHA/browser success. Kikka's existing saved versions are not re-audited or modified.

## Root cause and boundary

collectMissingOfficialCard's original(pool) first chooses linked receipts, then pick(pool), which always prefers a missing receipt identity over a due existing one. Saturday receipts use official-program; Kyoto sibling navigation uses stored-sibling-card, so a race can be untried under that identity despite an older calendar receipt. PR248 alternates card vs discovery only. It leaves this internal priority unchanged. When only discovery candidates exist, or a discovery turn is selected, untried Sunday candidates can precede all36 overdue Saturday candidates. This is not a403 exclusion or calendar parser failure. Finite queues can eventually drain; permanent production starvation is not established.

## Minimal proposal

Only missing-official-cards.js production code changes. Retain PR248's card/discovery alternation. Inside nonurgent discovery, alternate untried races and due existing receipts. Retry selection uses oldest next-at; untried selection retains existing ordering. Either class may fall back to the other when empty. No fixed Saturday/day/venue override. Keep urgent12h and witnessed URL precedence, direct-card acquisition, saved-card exclusion, receipt identities, gate, lease, frequency, quota and cooldown unchanged.

Carry lastDiscoveryClass through the existing cardSelection JSON even on an intervening card turn. Shared coordinator already preserves that object across cooldown; no coordinator/schema/writer changes. No additional SQL beyond PR248; no extra external source call or write SQL statement. Added JSON diagnostic fields report class and eligible class counts. Production/account D1 rows and JSON-size impact are unmeasured. The existing PR248 indexed history read remains one per selected history invocation, not once/hour.

## Validation and limitations

Corrected mixed72 fixture (generic weekend, without Kikka's special witnessed URL) fails two fairness/context assertions under published PR248 and passes this proposal. It checks all72 unique visits, alternating overdue/untried classes, and class retention through a card turn. Additional test preserves urgent selection, collector's existing4 metadata queries, and one gate query/zero source calls during shared wait. Full suite656/656 local; PR CI separate. Existing card/index navigation, exact date/venue/R filtering, shared403pause/lease, immutable prediction and LOCK tests remain green.

An earlier55/72 fixture result was contaminated by failing to persist the special witnessed URL; it is withdrawn as evidence. The corrected red failure is selection order/context retention, not permanent starvation or measured production coverage.

This restores selection opportunity; it does not create cards, histories, predictions or LOCKs. Multi-page discovery still takes separate natural turns and may fail parsing/HTTP or wait. Urgent precedence may delay nonurgent work. Completion before every race is not guaranteed. PR247/244 and model/newLOCK remain separate and unmerged. Draft PR/CI only; merge/deploy require new approval.
