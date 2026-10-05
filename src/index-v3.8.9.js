import app from './index-v3.8.8.js';
import {sha256} from './card-evidence.js';

export const VERSION='3.8.9';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const json=(d,s=200)=>new Response(JSON.stringify(d,null,2),{status:s,headers:H});
const stable=v=>JSON.stringify(sort(v));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v}
async function one(db,q,a=[]){try{return await db.prepare(q).bind(...a).first()}catch{return null}}

async function ensureImmutableMarkStorage(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS lab_user_mark_revisions(revision_id TEXT PRIMARY KEY,race_key TEXT NOT NULL,phase TEXT NOT NULL,revision_no INTEGER NOT NULL,track_condition TEXT,identity_basis TEXT NOT NULL,mark_payload_sha256 TEXT NOT NULL,audit_sha256 TEXT NOT NULL,audit_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(race_key,phase,revision_no))`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS lab_user_mark_entries(revision_id TEXT NOT NULL,race_key TEXT NOT NULL,phase TEXT NOT NULL,horse_no INTEGER,horse_name TEXT NOT NULL,mark TEXT NOT NULL,note TEXT,ordinal INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(revision_id,horse_name))`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_user_mark_rev ON lab_user_mark_revisions(race_key,phase,revision_no DESC)').run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_user_mark_revision_no_update BEFORE UPDATE ON lab_user_mark_revisions BEGIN SELECT RAISE(ABORT,'user mark revisions are immutable'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_user_mark_revision_no_delete BEFORE DELETE ON lab_user_mark_revisions BEGIN SELECT RAISE(ABORT,'user mark revisions are immutable'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_user_mark_entry_no_update BEFORE UPDATE ON lab_user_mark_entries BEGIN SELECT RAISE(ABORT,'user mark entries are immutable'); END`).run();
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_user_mark_entry_no_delete BEFORE DELETE ON lab_user_mark_entries BEGIN SELECT RAISE(ABORT,'user mark entries are immutable'); END`).run();
}
function authorized(request,env){
 const expected=env.USER_MARK_WRITE_TOKEN;
 if(!expected)return false;
 return request.headers.get('authorization')===`Bearer ${expected}`;
}
async function bodyOf(request){try{return await request.clone().json()}catch{return null}}
async function auditFirst(request,env,ctx,body){
 const u=new URL(request.url);u.pathname='/v1/lab/user-mark-audit';
 const r=new Request(u.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const response=await app.fetch(r,env,ctx);
 let data;try{data=await response.json()}catch{return{response,data:null}}
 return{response,data};
}
async function saveImmutable(request,env,ctx){
 const body=await bodyOf(request);if(!body)return json({ok:false,version:VERSION,error:'invalid JSON body'},400);
 const u=new URL(request.url);
 if((body.confirm??u.searchParams.get('confirm'))!=='SAVE')return json({ok:false,version:VERSION,error:'confirm=SAVE required'},409);
 if(!env.USER_MARK_WRITE_TOKEN)return json({ok:false,version:VERSION,error:'user-mark write secret is not configured',writeReady:false},503);
 if(!authorized(request,env))return json({ok:false,version:VERSION,error:'unauthorized'},401);
 const {response,data}=await auditFirst(request,env,ctx,body);
 if(!response.ok||!data?.ok)return json({...data,version:VERSION,scoreMutation:false},response.status);
 if(!data.race?.raceKey||!data.phase||!Array.isArray(data.audit?.marked))return json({ok:false,version:VERSION,error:'audit did not produce a persistable snapshot'},409);
 await ensureImmutableMarkStorage(env.DB);
 const cur=await one(env.DB,'SELECT COALESCE(MAX(revision_no),0) n FROM lab_user_mark_revisions WHERE race_key=? AND phase=?',[data.race.raceKey,data.phase]);
 const revisionNo=Number(cur?.n||0)+1,revisionId=`${data.race.raceKey}|${data.phase}|${revisionNo}`,stamp=new Date().toISOString();
 const marks=data.audit.marked.map((m,i)=>({horseNo:m.horseNo??null,horseName:m.horseName,mark:m.mark,note:m.note??null,ordinal:i+1}));
 const markPayloadSha256=await sha256(stable({raceKey:data.race.raceKey,phase:data.phase,track:body.track||null,marks}));
 const frozen={...data,version:VERSION,stage:'user-mark-saved-and-crosschecked',storageIntegrity:'immutable-at-insert',scoreMutation:false};
 const auditJson=stable(frozen),auditSha256=await sha256(auditJson);
 const statements=[env.DB.prepare('INSERT INTO lab_user_mark_revisions(revision_id,race_key,phase,revision_no,track_condition,identity_basis,mark_payload_sha256,audit_sha256,audit_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(revisionId,data.race.raceKey,data.phase,revisionNo,body.track||data.audit?.trackAssumption||null,data.identityBasis||'unknown',markPayloadSha256,auditSha256,auditJson,stamp),...marks.map(m=>env.DB.prepare('INSERT INTO lab_user_mark_entries(revision_id,race_key,phase,horse_no,horse_name,mark,note,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(revisionId,data.race.raceKey,data.phase,m.horseNo,m.horseName,m.mark,m.note,m.ordinal,stamp))];
 if(env.DB.batch)await env.DB.batch(statements);else for(const s of statements)await s.run();
 return json({...frozen,revisionNo,revisionId,markPayloadSha256,auditSha256,storageAtomic:Boolean(env.DB.batch),writeReady:true});
}

export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(url.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'immutable human-mark revisions'});
  if(url.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'immutable-user-mark-revisions',now:new Date().toISOString()});
  if(url.pathname==='/v1/lab/user-mark-capabilities')return json({ok:true,version:VERSION,phases:['initial','post_draw','final'],marks:['◎','○','▲','△','☆','注','消'],writeProtection:'Bearer secret + confirm=SAVE',writeReady:Boolean(env.USER_MARK_WRITE_TOKEN),principles:{humanMarksAreIndependentInput:true,scoreMutation:false,officialCardRequiredForPostDrawAndFinal:true,officialCardEvidenceRequired:true,initialCanUseIsolatedPrecardNames:true,horseNumbersNeverInferredBeforeOfficialCard:true,auditSnapshotPersistedWithRevision:true,nullEvidenceNeverPresentedAsZero:true,revisionImmutableAfterInsert:true,auditFinalizedBeforeInsert:true}});
  if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
  try{
   if(url.pathname==='/v1/lab/user-marks'&&request.method==='POST')return await saveImmutable(request,env,ctx);
   const response=await app.fetch(request,env,ctx);let data;try{data=await response.clone().json()}catch{return response}
   if(data&&typeof data==='object')data.version=VERSION;
   return json(data,response.status);
  }catch(error){return json({ok:false,version:VERSION,error:String(error?.message||error),scoreMutation:false},/immutable|official|Prospective LOCK/.test(String(error))?409:500)}
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
