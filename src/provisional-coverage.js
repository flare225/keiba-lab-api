import {targetInput} from './race-history-assessment-v3.31.0.js';
const VENUES=['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'];
async function rows(db,q,args=[]){try{return(await db.prepare(q).bind(...args).all()).results||[]}catch(e){if(/no such table/i.test(String(e)))return[];throw e}}
export async function provisionalCoverage(db,{from,to,venues=['東京','京都','新潟']}){
 targetInput({date:from,venue:'東京',raceNo:1});targetInput({date:to,venue:'東京',raceNo:1});
 const days=(Date.parse(to)-Date.parse(from))/86400000;if(days<0||days>7||!Array.isArray(venues)||!venues.length||new Set(venues).size!==venues.length||venues.some(v=>!VENUES.includes(v)))throw Error('Invalid bounded coverage scope');
 const roster=await rows(db,"SELECT race_key,json_array_length(json_extract(record_json,'$.runners')) runner_count FROM lab_expected_roster_registry WHERE substr(race_key,1,10) BETWEEN ? AND ? ORDER BY stored_at DESC,rowid DESC LIMIT 120",[from,to]);
 const saved=await rows(db,"SELECT race_key,snapshot_sha256,saved_at,json_extract(snapshot_json,'$.runnerCount') runner_count FROM lab_provisional_predictions_v1 WHERE substr(race_key,1,10) BETWEEN ? AND ?",[from,to]);
 const programs=await rows(db,'SELECT race_date,venue,race_no FROM jra_race_program WHERE race_date BETWEEN ? AND ?',[from,to]);
 const receipts=await rows(db,"SELECT race_key,status,next_at,error FROM lab_provisional_queue_v1 WHERE substr(race_key,1,10) BETWEEN ? AND ?",[from,to]);
 const latest=await rows(db,"SELECT run_id,trigger_kind,started_at,finished_at,status,result_json,error FROM lab_bounded_pipeline_runs WHERE job='provisional-prediction' AND trigger_kind='scheduled' ORDER BY started_at DESC LIMIT 3");
 const clock=(await rows(db,"SELECT next_at FROM lab_provisional_clock_v1 WHERE name='queue'"))[0]||null;
 const byRoster=new Map();for(const r of roster)if(!byRoster.has(r.race_key))byRoster.set(r.race_key,r);
 const races=[];for(let i=0;i<=days;i++){const date=new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10);for(const venue of venues)for(let raceNo=1;raceNo<=12;raceNo++){const key=`${date}:${venue}:${raceNo}`,r=byRoster.get(key),s=saved.find(x=>x.race_key===key),q=receipts.find(x=>x.race_key===key);races.push({date,venue,raceNo,raceKey:key,programSaved:programs.some(p=>p.race_date===date&&p.venue===venue&&p.race_no===raceNo),rosterSaved:!!r,rosterRunners:r?.runner_count??null,provisionalSaved:!!s,snapshotSha256:s?.snapshot_sha256??null,savedAt:s?.saved_at??null,queue:q||null,missingRosterRoute:r?null:'common-official-card-discovery-after-publication'});}}
 return{ok:true,from,to,races,summary:{slots:races.length,rosterSaved:races.filter(r=>r.rosterSaved).length,rosterMissing:races.filter(r=>!r.rosterSaved).length,provisionalSaved:races.filter(r=>r.provisionalSaved).length,provisionalMissing:races.filter(r=>!r.provisionalSaved).length},scheduled:latest.map(r=>({...r,result:r.result_json?JSON.parse(r.result_json):null,result_json:undefined})),nextClaimAt:clock?new Date(clock.next_at).toISOString():null,guardrails:{readOnly:true,externalRequests:0,historyRowsRead:false,metadataOnly:true,missingRosterDoesNotProveSourceUnpublished:true,manualExecutionProvesCron:false}};
}
