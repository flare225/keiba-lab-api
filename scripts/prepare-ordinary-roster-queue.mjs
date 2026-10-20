// Offline handoff only: no HTTP requests, DB clients, deployments or retries.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {EXPECTED_ROSTER_SEEDS} from '../src/expected-roster-seeds.js';
export const WEEK_SCOPE={dates:['2026-10-24','2026-10-25'],venues:['東京','京都','新潟'],racesPerMeeting:12};
const key=t=>`${t.date}:${t.venue}:${t.raceNo}`;
export function prepareOrdinaryRosterQueue(seeds=EXPECTED_ROSTER_SEEDS){
 const existing=new Map(),meetings=new Map();
 for(const {record:r,snapshotId} of seeds){
  if(!WEEK_SCOPE.dates.includes(r.date)||!WEEK_SCOPE.venues.includes(r.venue))continue;
  if(!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>12||!r.runners?.length||existing.has(key(r)))throw Error('Invalid/duplicate reviewed roster');
  existing.set(key(r),{raceKey:key(r),raceName:r.raceName,snapshotId,runnerCount:r.runners.length,sourceUrl:r.sourceUrl});
  const u=new URL(r.sourceUrl),id=u.hostname==='race.netkeiba.com'?u.searchParams.get('race_id'):null;
  if(id&&/^2026\d{8}$/.test(id)&&Number(id.slice(-2))===r.raceNo){
   const meetingKey=r.date+':'+r.venue,prefix=id.slice(0,-2),prior=meetings.get(meetingKey);
   if(prior&&prior.prefix!==prefix)throw Error('Conflicting source meeting identity');
   meetings.set(meetingKey,{prefix,witnessUrl:r.sourceUrl,witnessRaceKey:key(r)});
  }
 }
 const pending=[];
 // Saturday before Sunday; rotate venues at each race number.
 for(const date of WEEK_SCOPE.dates)for(let raceNo=1;raceNo<=12;raceNo++)for(const venue of WEEK_SCOPE.venues){
  const t={date,venue,raceNo};if(existing.has(key(t)))continue;
  const meeting=meetings.get(date+':'+venue);if(!meeting)throw Error('No reviewed sibling source for '+date+':'+venue);
  const raceId=meeting.prefix+String(raceNo).padStart(2,'0');
  pending.push({...t,raceKey:key(t),rosterStatus:'not-in-last-verified-rosters',publicationStatus:'not-checked',runners:null,sourceCandidate:{url:'https://race.netkeiba.com/race/shutuba_past.html?race_id='+raceId,identityBasis:'derived-from-reviewed-sibling-not-a-witnessed-link',witnessUrl:meeting.witnessUrl,witnessRaceKey:meeting.witnessRaceKey,fetchAuthorized:false},officialCollector:{path:'/v1/lab/missing-official-card-batch',body:{...t,confirm:'COLLECT'},requires:['quota-recovery-confirmed','current-shared-gate-and-lease','existing-discovery-receipt']}});
 }
 const plan={schema:'ordinary-roster-offline-queue-v1',scope:WEEK_SCOPE,evidence:{basis:'committed-reviewed-rosters-and-prior-production-report',reportUrl:'https://github.com/flare225/keiba-lab-api/issues/178#issuecomment-6283373947',productionRechecked:false,receiptsLoaded:false},summary:{programSlots:72,previouslyVerifiedRosterRaces:existing.size,previouslyVerifiedRosterEntries:[...existing.values()].reduce((n,r)=>n+r.runnerCount,0),pendingRosterCandidates:pending.length,newRacesSaved:0},knownRosters:[...existing.values()],pending,guardrails:{offlineOnly:true,externalRequests:0,databaseCalls:0,publicationNotInferred:true,formalCardNotInferred:true,queueIsNotAcquiredData:true}};
 return{...plan,sha256:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
// Select from the handoff using locally supplied receipts. The live collector
// still owns the authoritative gate, receipt lookup, lease and target parsing.
export function selectOrdinaryCandidate(plan,{now=Date.now(),gateChecked=false,quotaRecovered=false,nextBatchAt=0,lockedUntil=0,receipts=[]}={}){
 if(!quotaRecovered)return{status:'blocked',reason:'quota-recovery-unconfirmed',target:null};
 if(!gateChecked)return{status:'blocked',reason:'shared-gate-unconfirmed',target:null};
 const stamp=v=>{if(v==null||v==='')return 0;const n=typeof v==='number'?v:Date.parse(v);if(!Number.isFinite(n)||n<0)throw Error('Invalid gate/receipt timestamp');return n;};
 const blockedUntil=Math.max(stamp(nextBatchAt),stamp(lockedUntil));
 if(blockedUntil>now)return{status:'cooldown',nextAttemptAt:new Date(blockedUntil).toISOString(),target:null};
 const states=new Map(receipts.map(r=>[r.raceKey,r]));
 const target=plan.pending.find(t=>{const r=states.get(t.raceKey);return !r||(!r.savedReadbackVerified&&stamp(r.nextAttemptAt)<=now);});
 return target?{status:'candidate-only',target,execute:false,requiresLiveCollectorChecks:true}:{status:'waiting-or-verified',target:null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const plan=prepareOrdinaryRosterQueue(),out=process.argv[2];
 if(out)await writeFile(out,JSON.stringify(plan,null,2)+'\n');
 console.log(JSON.stringify({summary:plan.summary,meetings:WEEK_SCOPE.dates.flatMap(date=>WEEK_SCOPE.venues.map(venue=>({date,venue,pending:plan.pending.filter(r=>r.date===date&&r.venue===venue).map(r=>r.raceNo)}))),sha256:plan.sha256,externalRequests:0,databaseCalls:0,output:out||null},null,2));
}
