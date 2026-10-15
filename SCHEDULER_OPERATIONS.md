# Collection operations — v3.7.2

The hourly scheduler persists each run in `lab_collection_runs`, including start/end times, trigger kind, card/runner counts, missing cards, source errors and per-date results. Duplicate delivery of the same scheduled event does not repeat ingestion.

- `GET /v1/lab/scheduler-status?limit=10`: inspect recent runs and the most recent real cron execution. A manual run never counts as cron evidence. The endpoint marks the cron overdue after 90 minutes and running jobs stalled after 30 minutes.
- `POST /v1/lab/scheduler-run`: run the same collection pipeline manually and save a separate manual record. GET is refused. This writes staged programs/cards if available; it does not seal predictions.

Run status is one of `running`, `success`, `partial`, `cards-not-discovered`, `error`, or `no-work`. Missing cards are not proof that JRA has not published them. Fetch/parsing errors remain visible separately.

Program staging must succeed before card collection begins. The rotation, eight-card batch limit and source timeouts from v3.7.1 are retained. Existing audit and prospective LOCK gates remain active.

Validation: 36 passing tests, including actual SQLite persistence of run records, duplicate delivery, manual/cron separation, exception recording, stale heartbeat detection, staging failure and endpoint method/limit checks.

Production verification (2026-10-05 JST): PR #2 merged as d1ca3b4dcd86412e1c213a27c7dfbfd073071ea2; the public deploy-check returns v3.7.2 and build persisted-collection-runs.

Manual production run manual:6f54d9ca-89fb-46bf-b7ee-f8df9434d252 started at 2026-10-05T05:57:10.431Z and completed with 16 attempted cards, 16 cards not discovered, zero saved cards/runners, zero failed cards and zero source errors. Its record correctly remains trigger_kind=manual.

The October 10–12 storage audit remains consistent: 72 programs, zero cards/runners and no anomalies. Saudi RC is not sealed.

A bounded observation spanning 15:00 JST did not find a scheduled invocation. The status endpoint still reports cronHeartbeat=not-observed; manual success is not proof of automatic execution. This does not establish a configuration fault: Cloudflare documents that Cron Trigger changes can take up to 15 minutes to propagate (https://developers.cloudflare.com/workers/configuration/cron-triggers/). The deployed runtime configuration and a subsequent real cron invocation still need verification.

No direct Cloudflare connection is available in this workspace; plugin discovery returned no Cloudflare matches. Do not claim the cron is operational until a scheduled run or the provider's execution record is observed.

## Scheduled D1 read budget (v3.49.19)

All allowed Worker cron jobs now share a UTC-day counter in
`lab_scheduled_read_usage`. Successful query `meta.rows_read` is accumulated
atomically, including reads made by write statements and batch statements.
`first()` obtains the same SQL result through `all()` once, retaining metadata
and returning the first row/column with the existing null/error behavior.
The existing SQL, transactions, collection cooldown and user write routes are
unchanged. Bookkeeping is outside this counter.

Before dispatching the next cron invocation, a counter at or above 1,000,000
observed rows pauses background jobs until the next UTC day (09:00 JST).
Missing metadata also pauses subsequent jobs for that day, rather than treating
unknown reads as zero. If the durable budget cannot be checked, no job starts.
Running jobs finish normally and their counters are flushed even after errors;
there is no interruption inside an existing save/transaction. Concurrent jobs
and a large individual query can overshoot the threshold.

GET `/v1/lab/scheduled-read-budget` exposes the measured scope and next reset.
The work progress page shows the same counter. It does not measure user/API
requests, manual collection, CI SQL, other Workers/databases, bookkeeping, or
usage before this instrumentation was deployed. Failed queries may have
unreported reads. This is **not** account usage or a guarantee against the D1
free-tier quota. No paid-plan or billing changes were made. Do not compute
account remaining quota as 5,000,000 minus this partial counter.

## Upcoming-race priority and split budget (v3.49.20)

Supersedes the v3.49.19 1,000,000-row threshold: the shared scheduled budget
is now 2,000,000 observed rows/day, with learning-cron invocations capped at
250,000/day within that total. The initial observation was 270,358 reads over
roughly 3.7 hours; 1,000,000 would be restrictive if that pace continued for a
whole day. These remain provisional operating budgets, not measured account
allowances. No guarantee of remaining free-tier account quota is made.

A learning-only pause does not block collection invocations. A shared budget,
unknown measurement or D1 quota pause still blocks both. In-flight overshoot
remains possible. The aggregate counter is retained without resetting it;
pre-split observations are explicitly unattributed and still count toward the
shared total. New per-lane and aggregate totals commit in a single D1 batch.
User writes, manual collection and existing shared JRA cooldown are unchanged.

Each scheduled history turn checks upcoming target races before ordinary
history, replacing alternate past-training-first turns. Ordinary collection
still runs when upcoming targets have no actionable work, including non-target
races. A blocked/cooldown upcoming request never falls through to a second
source request. This does not invent missing profile links or final cards.

## Cached profiles before discovery (v3.49.21)

The upcoming-race collector now checks verified cached profile work across all
upcoming target races before requesting a profile-discovery page. Previously an
earlier race's discovery refresh could fail and impose the shared pause before
a later race's already-known horses were considered. Discovery remains enabled
when cached work is exhausted. Missing links are never guessed, formal cards
remain separate, and an active global cooldown is never bypassed.

## User-supplied editorial reference notes (v3.49.22)

The supplied Shuka article is summarized into 18 unverified horse notes with
source URL, publication date, user-provided timestamp, pedigree claims,
reported performances, editorial views and reconciliation checks. The article
is not an official data provider. Its aggregate trends and opinions never feed
scores, running-style classifications, model training or mark revisions.

Allowed cron invocations seed `lab_editorial_reference_notes` idempotently under
the existing scheduled D1 budget. Only this new table and its immutable triggers
are written; no public write endpoint is added. Each stored note includes source
metadata and SHA-256, and reads compare both content and hash to the versioned
reference. Corrections require a new reference version. Seed failure does not
block the existing collection jobs and never counts as successful persistence.

GET `/v1/lab/race-reference-notes?date=2026-10-18&venue=京都&race_no=11` reports actual
saved counts, and `/lab/race-reference-notes` with the same query renders them.
The progress page links to the notes. GET never creates schema or seeds rows;
0 saved notes must remain unconfirmed until a real cron seeds and readback
returns all 18. Source notes are not new official past performances.

## Article claim reconciliation (v3.49.23)

A separate immutable `lab_editorial_claim_checks` table records the comparison
of 36 individually named race values against stored JRA profiles. It never
modifies the original editorial notes, mark revisions, LOCK, model weights or
learning credit. Exact horse, year, race, venue, surface and specified distance
must identify one valid prior result. Missing/ambiguous/wrong-cohort/non-JRA or
future evidence remains pending; disagreements are retained as contradictions.
Closing times additionally require the existing immutable official result-page
proof bound to the same past row and race metadata.

Allowed cron jobs check two bounded evidence queries. A source fingerprint
prevents repeated writes and reconciliation when evidence is unchanged. All
claim results for a new fingerprint commit atomically; former snapshots remain
immutable. No new verification is generated on/after the target race day.
GET references now returns hash-checked results and links matched facts to JRA
sources on the reference page. Career totals, pedigree, opinions, running style,
pace, aggregate historical trends and unsupported facts remain unverified.
The normal assessment adapter continues to read canonical past-performance rows
under its existing limits; article claims do not add a duplicate score feature.

## Exact JRA race-display aliases (v3.49.24)

Stored JRA profile rows use `チューリップ` and `スイートピー` for the
corresponding named stakes. Reconciliation v2 recognizes only these two exact
abbreviations; similar names/suffixes, wrong years, courses, sources and duplicate
candidates still remain pending. No past-performance rows are renamed.

The policy change generates a new fingerprint even if source data is unchanged.
Compatible v1 evidence stays readable until the next normal cron writes v2,
and all old snapshots remain immutable. Claim definitions and values are the
same between versions; this is not a new score rule or a manual claim override.
# v3.49.25: upcoming official pre-draw prior details

Prior-result enrichment can use the saved JRA confirmed pre-draw roster before numbered cards exist. Supplementary/article rosters cannot enter this path. The existing age/date/course filters, verified profile-to-result identity, immutable evidence, one-horse batch and shared JRA lease/cooldown remain in force. Upcoming confirmed rosters receive scheduled detail slots before archive targets. No numbered card, mark, LOCK or prediction is created by this path.

