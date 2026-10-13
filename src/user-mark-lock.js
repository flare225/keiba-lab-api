import {sha256,runnerFingerprint} from './card-evidence.js';
import {markRecordProvenance} from './mark-record-provenance.js';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store','access-control-allow-origin':'*'}});
export function lockDeadline(date,start,now){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T00:00:00+09:00')))throw Error('レース日付を確認できません。');
 const day=new Date(now+9*3600000).toISOString().slice(0,10);
 if(date<day)throw Error('過去レースは事前LOCKできません。');
 if(date>day)return new Date(Date.parse(date+'T00:00:00+09:00')).toISOString();
 const m=String(start||'').match(/^(\d{1,2}):(\d{2})$/);
 if(!m||Number(m[1])>23||Number(m[2])>59)throw Error('当日の発走時刻が未確認です。事前LOCKを保留します。');
 const deadline=Date.parse(date+'T'+m[1].padStart(2,'0')+':'+m[2]+':00+09:00');
 if(now>=deadline)throw Error('発走時刻以降は事前LOCKできません。');
 return new Date(deadline).toISOString();
}
async function ensure(db){
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_user_mark_locks(race_key TEXT NOT NULL,phase TEXT NOT NULL,revision_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,snapshot_sha256 TEXT NOT NULL,locked_at TEXT NOT NULL,deadline TEXT NOT NULL,PRIMARY KEY(race_key,phase))').run();
 for(const action of ['UPDATE','DELETE'])await db.prepare('CREATE TRIGGER IF NOT EXISTS user_mark_lock_no_'+action.toLowerCase()+' BEFORE '+action+" ON lab_user_mark_locks BEGIN SELECT RAISE(ABORT,'user mark locks are immutable'); END").run();
}
export async function readUserMarkLock(db,raceKey,phase){
 let row;try{row=await db.prepare('SELECT * FROM lab_user_mark_locks WHERE race_key=? AND phase=?').bind(raceKey,phase).first()}catch(e){if(/no such table/.test(String(e)))return null;throw e}
 if(!row)return null;
 if(await sha256(row.snapshot_json)!==row.snapshot_sha256)throw Error('事前LOCKのハッシュが一致しません。');
 return {revisionId:row.revision_id,lockedAt:row.locked_at,deadline:row.deadline,snapshotSha256:row.snapshot_sha256,immutable:true};
}
export async function lockUserMark(db,input,now=Date.now()){
 const date=String(input.date||''),venue=String(input.venue||''),no=Number(input.raceNo),phase=input.phase;
 if(!['post_draw','final'].includes(phase)||!Number.isInteger(no)||no<1||no>12||!venue||venue.length>30||typeof input.revisionId!=='string'||input.revisionId.length>200)throw Error('枠順後または最終印のDB保存版を指定してください。');
 const race=await db.prepare('SELECT * FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(date,venue,no).first();
 if(!race)throw Error('正式出馬表が未保存です。');
 const old=await readUserMarkLock(db,race.race_key,phase);
 if(old){if(old.revisionId!==input.revisionId)throw Error('別の改訂が既にLOCKされています。上書きできません。');return {ok:true,stage:'user-mark-lock-verified',raceKey:race.race_key,phase,...old,idempotent:true};}
 const program=await db.prepare('SELECT start_time FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=? LIMIT 1').bind(date,venue,no).first();
 const deadline=lockDeadline(date,program?.start_time,now);
 const revision=await db.prepare('SELECT * FROM lab_user_mark_revisions WHERE race_key=? AND phase=? ORDER BY revision_no DESC LIMIT 1').bind(race.race_key,phase).first();
 if(!revision||revision.revision_id!==input.revisionId)throw Error('最新のDB保存版を指定してください。');
 const entries=(await db.prepare('SELECT horse_no,horse_name,mark,note,ordinal FROM lab_user_mark_entries WHERE revision_id=? ORDER BY ordinal').bind(revision.revision_id).all()).results||[];
 const provenance=await markRecordProvenance({phase,createdAt:revision.created_at,auditJson:revision.audit_json,auditSha256:revision.audit_sha256,entries},date);
 if(!provenance.integrityVerified||Date.parse(revision.created_at)>now)throw Error('印の保存版の整合性・時刻を確認できません。');
 const runners=(await db.prepare('SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all()).results||[];
 const evidence=await db.prepare('SELECT * FROM lab_card_source_evidence WHERE race_key=?').bind(race.race_key).first();
 const fingerprint=await sha256(runnerFingerprint(runners));
 if(!runners.length||runners.length!==Number(race.runner_count)||!evidence||evidence.card_fetched_at!==race.fetched_at||evidence.runner_sha256!==fingerprint||!evidence.horse_numbers_observed||!evidence.frames_observed||Number(evidence.declared_count)!==runners.length||Number(evidence.parsed_count)!==runners.length||Number(evidence.source_row_count)!==runners.length||entries.some(e=>!runners.some(r=>r.horse_no===e.horse_no&&r.horse_name===e.horse_name)))throw Error('正式出馬表と印の対応を確認できません。');
 const outcomes=await db.prepare('SELECT COUNT(*) n FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL').bind(race.race_key).first();
 if(Number(outcomes?.n)>0)throw Error('結果保存済みのレースは事前LOCKできません。');
 await ensure(db);
 const lockedAt=new Date(now).toISOString(),snapshot=JSON.stringify({raceKey:race.race_key,date,phase,revisionId:revision.revision_id,auditSha256:revision.audit_sha256,runnerSha256:fingerprint,entries,runners,lockedAt,deadline}),hash=await sha256(snapshot);
 const result=await db.prepare("INSERT OR IGNORE INTO lab_user_mark_locks SELECT ?,?,?,?,?,?,? WHERE strftime('%Y-%m-%dT%H:%M:%fZ','now')<? AND NOT EXISTS(SELECT 1 FROM lab_race_outcomes WHERE race_key=? AND finish_position IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM lab_user_mark_revisions WHERE race_key=? AND phase=? AND revision_no>?) AND EXISTS(SELECT 1 FROM lab_card_source_evidence e JOIN jra_races r ON r.race_key=e.race_key WHERE e.race_key=? AND e.card_fetched_at=r.fetched_at AND e.runner_sha256=?) AND (SELECT COUNT(*) FROM jra_runners WHERE race_key=?)=? AND NOT EXISTS(SELECT 1 FROM jra_runners r WHERE r.race_key=? AND NOT EXISTS(SELECT 1 FROM json_each(?,\'$.runners\') j WHERE json_extract(j.value,\'$.horse_no\')=r.horse_no AND json_extract(j.value,\'$.horse_name\')=r.horse_name AND json_extract(j.value,\'$.frame_no\')=r.frame_no)) AND (? > substr(datetime(\'now\',\'+9 hours\'),1,10) OR EXISTS(SELECT 1 FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=? AND start_time=?))").bind(race.race_key,phase,revision.revision_id,snapshot,hash,lockedAt,deadline,deadline,race.race_key,race.race_key,phase,revision.revision_no,race.race_key,fingerprint,race.race_key,runners.length,race.race_key,snapshot,date,date,venue,no,program?.start_time||'').run();
 const saved=await readUserMarkLock(db,race.race_key,phase);
 if(!saved||saved.revisionId!==revision.revision_id)throw Error('LOCK直前にデータが変わりました。固定を確認できません。');
 return {ok:true,stage:'user-mark-lock-verified',raceKey:race.race_key,phase,...saved,idempotent:Number(result.meta?.changes)!==1};
}
export async function userMarkLockEndpoint(request,env){
 const u=new URL(request.url);
 try{
  if(request.method==='GET'){
   const phase=u.searchParams.get('phase'),date=u.searchParams.get('date'),venue=u.searchParams.get('venue'),no=Number(u.searchParams.get('race_no'));
   if(!['post_draw','final'].includes(phase)||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!venue||venue.length>30||!Number.isInteger(no)||no<1||no>12)return json({ok:false,error:'レース指定が不正です。'},400);
   return json({ok:true,lock:await readUserMarkLock(env.DB,date+':'+venue+':'+no,phase)});
  }
  if(request.method!=='POST')return json({ok:false,error:'POSTが必要です。'},405);
  if(typeof env.USER_MARK_WRITE_TOKEN!=='string'||env.USER_MARK_WRITE_TOKEN.length<24)return json({ok:false,error:'保存接続が未設定です。'},503);
  if(request.headers.get('authorization')!=='Bearer '+env.USER_MARK_WRITE_TOKEN)return json({ok:false,error:'unauthorized'},401);
  const input=await request.json();if(input.confirm!=='LOCK')return json({ok:false,error:'confirm LOCKが必要です。'},400);
  return json(await lockUserMark(env.DB,input));
 }catch(e){return json({ok:false,error:String(e.message||e)},409);}
}
