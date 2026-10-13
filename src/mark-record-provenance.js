import {sha256} from './card-evidence.js';

// A prior-day server record is evidence of timing, not an explicit prediction LOCK.
export async function markRecordProvenance(revision,raceDate){
 const result={status:'unverified',integrityVerified:false,recordedBeforeRaceDay:false,preRaceLock:false,validationCreditEligible:false};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raceDate||''))return result;
 const stamp=revision.createdAt;
 if(typeof stamp!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(stamp)||!Number.isFinite(Date.parse(stamp)))return result;
 const savedDay=new Date(Date.parse(stamp)+9*3600000).toISOString().slice(0,10);
 const midnight=Date.parse(raceDate+'T00:00:00+09:00');
 if(!Number.isFinite(midnight))return result;
 result.savedDayJst=savedDay;
 result.status=savedDay>raceDate?'retrospective':savedDay===raceDate?'race-day-time-unverified':'unverified';
 const raw=revision.auditJson,expected=revision.auditSha256;
 if(typeof raw!=='string'||!expected||await sha256(raw)!==expected)return result;
 let audit;try{audit=JSON.parse(raw)}catch{return result}
 const marked=audit?.audit?.marked,entries=revision.entries;
 if(!Array.isArray(marked)||!Array.isArray(entries)||!entries.length||marked.length!==entries.length)return result;
 if(audit.race?.date!==raceDate||audit.phase!==revision.phase)return result;
 const names=new Set();
 for(let i=0;i<entries.length;i++){
  const e=entries[i],m=marked[i];
  if(!m||names.has(e.horse_name)||e.horse_name!==m.horseName||(e.horse_no??null)!==(m.horseNo??null)||e.mark!==m.mark||(e.note??null)!==(m.note??null)||Number(e.ordinal)!==i+1)return result;
  names.add(e.horse_name);
 }
 result.integrityVerified=true;
 if(Date.parse(stamp)<midnight){result.recordedBeforeRaceDay=true;result.status='verified-prior-day-record'}
 return result;
}
