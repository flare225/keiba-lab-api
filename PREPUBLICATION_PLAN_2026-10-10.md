# KEIBA LABO prepublication execution plan — 2026-10-10 to 2026-10-12

## Validation target

- Saudi Arabia Royal Cup (G3)
- 2026-10-10 Tokyo 11R
- Turf 1600m, 2yo open
- Scheduled post: 15:45 JST
- Strict prospective target: yes

## Important publication timing

This is a three-day JRA meeting. Do not require all 72 weekend race cards to be present before sealing the Saudi RC.

JRA's special schedule states that the numbered card for the 2026-10-12 Swan Stakes is published after 10:00 JST on 2026-10-10, while numbered cards for other 2026-10-12 races are published after 10:00 JST on 2026-10-11.

Therefore weekend-wide storage completeness and Saudi RC prospective readiness are separate gates.

## Required order

1. Keep staging and collecting every published JRA race card.
2. Audit saved rows and source evidence continuously; missing future cards remain `card-not-discovered`, never assumed unpublished.
3. As soon as the official 2026-10-10 Tokyo 11R card is stored, run target-level prelock readiness.
4. Require an explicit pre-race track assumption. Never default an omitted track to `良` for a prospective seal.
5. Require complete target runner coverage, current official card evidence, zero official outcomes and no existing prospective seal.
6. Run the prediction pipeline, recheck exact card identity, then atomically write the immutable SHA-256 seal.
7. Re-read the seal and verify idempotent repeated-call behavior.
8. Continue collecting the remaining 2026-10-11 and 2026-10-12 cards as JRA publishes them; their delayed publication must not block the already-valid Saudi RC holdout.

## Readiness endpoint

v3.8.0 adds:

`GET /v1/lab/prelock-readiness?date=2026-10-10&venue=東京&race_no=11&track=<explicit-assumption>`

`readyToSeal=true` is target-scoped. It must not depend on unrelated future race cards being published.

## Evidence

Official JRA pages verified on 2026-10-05 JST:

- Saudi RC: 2026-10-10, Tokyo, turf 1600m.
- JRA program: Tokyo 11R, scheduled 15:45 JST.
- Saudi RC runner information: scheduled for 2026-10-06.
- Saudi RC official race card: scheduled for 2026-10-08.
- Three-day-meeting notice: Swan Stakes numbered card after 10:00 on 2026-10-10; other 2026-10-12 numbered cards after 10:00 on 2026-10-11.
