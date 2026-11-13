import {sha256} from './card-evidence.js';
const nonstarters=new Set(['scratched','excluded']);
const terminals=new Set(['finished','scratched','excluded','did-not-finish','disqualified']);
const official=(value,path)=>{try{const u=new URL(value);return u.protocol==='https:'&&['www.jra.go.jp','jra.go.jp','www.jra.jp','jra.jp'].includes(u.hostname)&&path.test(u.pathname);}catch{return false;}};
// Only a field-size disagreement needs these two bounded stored reads. Never
// rewrite a source, infer a withdrawal, or turn a DNF into a nonstarter.
export async function reconcileHistoryStarterCounts(db,rich,profiles,beforeDate){
 const candidates=rich.filter(r=>r.race_key&&r.race_date<beforeDate&&profiles.some(p=>p.race_date===r.race_date&&p.venue===r.venue&&Number(p.field_size)<Number(r.field_size)&&Number(p.field_size)>=2));
 if(!db||!candidates.length)return rich;
 const keys=JSON.stringify([...new Set(candidates.map(r=>r.race_key))]);
 let results,proofs;
 try{
  results=(await db.prepare('SELECT d.*,x.horse_name FROM lab_race_result_details d JOIN jra_runners x ON x.race_key=d.race_key AND x.horse_no=d.horse_no WHERE d.race_key IN (SELECT value FROM json_each(?))').bind(keys).all()).results||[];
  proofs=(await db.prepare('SELECT * FROM lab_card_withdrawals_v1 WHERE race_key IN (SELECT value FROM json_each(?))').bind(keys).all()).results||[];
 }catch(e){if(/no such table/i.test(String(e)))return rich;throw e;}
 const verified=[];
 for(const p of proofs){
  try{
   if(await sha256(p.proof_json)!==p.proof_sha256)continue;
   const w=JSON.parse(p.proof_json);
   if(`${w.date}:${w.venue}:${w.raceNo}`!==p.race_key||w.horseNo!==p.horse_no||w.horseName!==p.horse_name||w.status!==p.status||!['取消','除外'].includes(w.status)||!official(w.sourceUrl,/^\/news\//)||!/^[a-f0-9]{64}$/.test(p.card_source_sha256)||!Number.isFinite(Date.parse(p.recorded_at))||p.recorded_at>=beforeDate)continue;
   verified.push({...w,raceKey:p.race_key,proofSha256:p.proof_sha256,cardSourceSha256:p.card_source_sha256});
  }catch{continue;}
 }
 return rich.map(r=>{
  if(!candidates.includes(r))return r;
  const rows=results.filter(x=>x.race_key===r.race_key),declared=Number(r.field_size);
  if(rows.length!==declared||new Set(rows.map(x=>x.horse_no)).size!==declared||rows.some(x=>!Number.isInteger(x.horse_no)||x.horse_no<1||x.horse_no>declared||!terminals.has(x.finish_status)||x.source_url!==r.source_url)||!official(r.source_url,/^\/JRADB\/accessS\.html$/))return r;
  const removed=rows.filter(x=>nonstarters.has(x.finish_status)),starters=declared-removed.length;
  if(!removed.length||starters<2||rows.some(x=>x.finish_status==='finished'?(!Number.isInteger(x.finish_position)||x.finish_position<1||x.finish_position>starters):x.finish_position!=null))return r;
  const finished=rows.filter(x=>x.finish_status==='finished');if(new Set(finished.map(x=>x.finish_position)).size!==finished.length)return r;
  const evidence=removed.map(x=>verified.find(w=>w.raceKey===r.race_key&&w.horseNo===x.horse_no&&w.horseName===x.horse_name&&w.status===(x.finish_status==='scratched'?'取消':'除外')));
  if(evidence.some(x=>!x)||!profiles.some(p=>p.race_date===r.race_date&&p.venue===r.venue&&Number(p.field_size)===starters))return r;
  return{...r,field_size:starters,declared_field_size:declared,field_size_basis:{kind:'complete-result-with-verified-nonstarters',declared,starters,resultSourceUrl:r.source_url,withdrawals:evidence}};
 });
}
