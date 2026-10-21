// Offline analysis: no fetch, database connection or writes to production.
import {readFile} from 'node:fs/promises';
const coverage=JSON.parse(await readFile('artifact-input/coverage.json','utf8'));
const response=JSON.parse(await readFile('artifact-input/cron-snapshot.json','utf8'));
const s=response.snapshot;
console.log('ARTIFACT_ONLY_ANALYSIS',JSON.stringify({databaseRequests:0,rosterReceipts:coverage.races.filter(r=>r.rosterAcquisition?.sourceRole==='supplementary-netkeiba').map(r=>({target:r.raceKey,...r.rosterAcquisition})),unassessed:s.runners.filter(r=>r.rank==null).map(r=>({horseName:r.horseName,history:s.histories.find(h=>h.horseName===r.horseName),assessmentNotes:r.assessment?.notes}))}));
