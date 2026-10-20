import {REMAINING_SPECIAL_REVIEWED} from '../src/remaining-special-reviewed-history.js';
process.env.ROSTER_TARGETS=JSON.stringify(REMAINING_SPECIAL_REVIEWED.map(c=>({date:c.seed.record.date,venue:c.seed.record.venue,raceNo:c.seed.record.raceNo,count:c.seed.record.runners.length,rows:c.rows.length})));
await import('./verify-live-expected-rosters.mjs');
