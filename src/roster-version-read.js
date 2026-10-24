import {targetInput} from './race-history-assessment-v3.31.0.js';
import {sha256,runnerFingerprint} from './card-evidence.js';
import {metaFromRacecardUrl} from './index-v1.1.4.js';
async function first(db,q,args){try{return await db.prepare(q).bind(...args).first()}catch(e){if(/no such table/.test(String(e)))return null;throw e}}
export async function readRosterVersion(db,input){
 const t=targetInput(input),key=`${t.date}:${t.venue}:${t.raceNo}`,basis=input.basis||'auto';
 if(!['auto','official-card','confirmed-predraw'].includes(basis))throw Error('未対応の名簿版です。');
 let row,runners,kind;
 if(basis!=='confirmed-predraw'){
  const r=await first(db,'SELECT * FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[t.date,t.venue,t.raceNo]);
  if(r){
   const e=await first(db,'SELECT * FROM lab_card_source_evidence WHERE race_key=?',[r.race_key]);
   const rs=(await db.prepare('SELECT * FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(r.race_key).all()).results||[];
   if(!e||r.race_key!==key||rs.length!==r.runner_count||!rs.length||rs.some((x,i)=>x.horse_no!==i+1||!Number.isInteger(x.frame_no)||x.frame_no<1||x.frame_no>8)||!e.horse_numbers_observed||!e.frames_observed||e.declared_count!==rs.length||e.source_row_count!==rs.length||e.parsed_count!==rs.length||e.card_fetched_at!==r.fetched_at||e.runner_sha256!==await sha256(runnerFingerprint(rs)))throw Error('正式カードの保存証跡が一致しません。');
   row={source_url:e.source_url,source_sha256:e.source_sha256,checked_at:r.fetched_at};runners=rs;kind='official-card';
  }
 }
 if(!row&&basis!=='official-card'){
  row=await first(db,'SELECT * FROM lab_confirmed_predraw_rosters WHERE race_key=?',[key]);
  if(row){runners=JSON.parse(row.runners_json);kind='confirmed-predraw';if(!Array.isArray(runners)||!runners.length||runners.length>18||runners.some(x=>x.horse_no!=null||x.frame_no!=null||!x.horse_name)||new Set(runners.map(x=>x.horse_name)).size!==runners.length)throw Error('枠順確定前名簿の保存内容が不正です。');}
 }
 if(!row)return null;
 const meta=metaFromRacecardUrl(row.source_url);
 if(!meta||new URL(row.source_url).origin!=='https://www.jra.go.jp'||new URL(row.source_url).pathname!=='/JRADB/accessD.html'||meta.date!==t.date||meta.venue!==t.venue||meta.raceNo!==t.raceNo||!/^[a-f0-9]{64}$/.test(row.source_sha256)||!Number.isFinite(Date.parse(row.checked_at)))throw Error('名簿の対象・出典・保存時刻が不正です。');
 const snapshot={raceKey:key,rosterBasis:kind,sourceUrl:row.source_url,sourceSha256:row.source_sha256,savedAt:row.checked_at,runners:runners.map(x=>({horseName:x.horse_name,horseNo:x.horse_no??null,frameNo:x.frame_no??null,age:x.age??null,jockey:x.jockey??null,assignedWeight:x.assigned_weight??null}))};
 const hash=await sha256(JSON.stringify(snapshot));if(input.sha256&&input.sha256!==hash)throw Error('指定された名簿版は現在の保存版と一致しません。旧想定版へfallbackしません。');
 return{ok:true,snapshot,snapshotSha256:hash,source:{...t,rosterBasis:kind,snapshotId:`${kind}:${key}:${hash}`,sourceUrl:row.source_url,observedAt:row.checked_at},runners:snapshot.runners,integrity:{runnerFingerprintVerified:kind==='official-card',sourceHtmlRehashed:false,storedSnapshotHashAvailable:false,hashScope:'canonical DB readback snapshot; source HTML hash is separate'},guardrails:{readOnly:true,externalRequests:0,authoritativeForCard:kind==='official-card',eligibleForProspectiveSeal:false,predictionReferencesChanged:false}};
}
