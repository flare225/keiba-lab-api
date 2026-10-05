import app from './index-v3.8.7.js';
import {sha256,requireLockEvidence} from './card-evidence.js';

export const VERSION='3.8.8';
const H={
  'content-type':'application/json; charset=UTF-8',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,POST,OPTIONS',
  'access-control-allow-headers':'content-type,authorization',
};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
const stable=value=>JSON.stringify(sortObject(value));
function sortObject(value){
  if(Array.isArray(value))return value.map(sortObject);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sortObject(value[k])]));
  return value;
}
async function first(db,sql,args=[]){
  try{return await db.prepare(sql).bind(...args).first()}catch{return null}
}
async function all(db,sql,args=[]){
  try{return((await db.prepare(sql).bind(...args).all()).results||[])}catch{return[]}
}

async function parseBodyClone(request){
  try{return await request.clone().json()}catch{return null}
}

async function verifyOfficialCardEvidence(db,body){
  if(!body||!body.date||!body.venue)return null;
  const raceNo=Number(body.raceNo??body.race_no);
  if(!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return null;
  const race=await first(db,`SELECT race_key,race_date,venue,race_no,race_name,runner_count
    FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`,[String(body.date),String(body.venue),raceNo]);
  if(!race)return null;
  const runners=await all(db,`SELECT horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer
    FROM jra_runners WHERE race_key=? ORDER BY horse_no`,[race.race_key]);
  if(!runners.length||runners.length!==Number(race.runner_count||0))throw new Error('official numbered card is incomplete for user-mark audit');
  const evidence=await requireLockEvidence(db,race,runners);
  return{
    raceKey:race.race_key,
    sourceSha256:evidence.source_sha256,
    runnerSha256:evidence.runner_sha256,
    declaredCount:Number(evidence.declared_count),
    sourceRowCount:Number(evidence.source_row_count),
    parsedCount:Number(evidence.parsed_count),
    countBasis:evidence.count_basis,
    cardFetchedAt:evidence.card_fetched_at,
    verifiedAt:evidence.verified_at,
  };
}

function nullIfDbNull(target,key,row,column){
  if(row&&row[column]===null)target[key]=null;
}

async function repairNullEvidence(db,data){
  const raceKey=data?.race?.raceKey;
  const track=data?.audit?.trackAssumption;
  const marked=data?.audit?.marked;
  if(!raceKey||!track||!Array.isArray(marked))return data;
  const integrated=await all(db,`SELECT horse_no,prefinal_points,basic_score,recent_score,pace_style_score,course_distance_score,ground_score,condition_prep_score
    FROM lab_integrated_snapshots WHERE race_key=? AND model_version='2.3.0' AND track_condition=?`,[raceKey,track]);
  const base=await all(db,`SELECT horse_no,model_coverage_pct,confidence_pct FROM lab_prediction_snapshots
    WHERE race_key=? AND model_version='1.5.0' AND track_condition=?`,[raceKey,track]);
  const pace=await all(db,`SELECT horse_no,pace_style_fit_score FROM lab_pace_style_snapshots
    WHERE race_key=? AND model_version='1.8.0'`,[raceKey]);
  const im=new Map(integrated.map(x=>[Number(x.horse_no),x]));
  const bm=new Map(base.map(x=>[Number(x.horse_no),x]));
  const pm=new Map(pace.map(x=>[Number(x.horse_no),x]));
  for(const horse of marked){
    const no=Number(horse.horseNo),i=im.get(no),b=bm.get(no),p=pm.get(no);
    if(i){
      if(i.prefinal_points===null)horse.laboScore=null;
      if(horse.components){
        nullIfDbNull(horse.components,'basic',i,'basic_score');
        nullIfDbNull(horse.components,'recent',i,'recent_score');
        nullIfDbNull(horse.components,'paceStyle',i,'pace_style_score');
        nullIfDbNull(horse.components,'courseDistance',i,'course_distance_score');
        nullIfDbNull(horse.components,'ground',i,'ground_score');
        nullIfDbNull(horse.components,'condition',i,'condition_prep_score');
      }
    }
    if(horse.evidence){
      nullIfDbNull(horse.evidence,'modelCoveragePct',b,'model_coverage_pct');
      nullIfDbNull(horse.evidence,'baseConfidencePct',b,'confidence_pct');
      nullIfDbNull(horse.evidence,'paceFit',p,'pace_style_fit_score');
    }
  }
  if(Array.isArray(data.audit.unmarkedTopCandidates)){
    for(const horse of data.audit.unmarkedTopCandidates){
      const row=im.get(Number(horse.horseNo));
      if(row&&row.prefinal_points===null)horse.laboScore=null;
    }
  }
  return data;
}

async function enrichAudit(db,data,evidence){
  if(!data||data.ok===false)return data;
  await repairNullEvidence(db,data);
  if(evidence&&data.audit){
    data.identityBasis='official-numbered-card-evidence-verified';
    data.audit.officialCardEvidence=evidence;
    data.audit.guardrails={...(data.audit.guardrails||{}),officialCardFingerprintRequired:true,nullEvidenceNeverPresentedAsZero:true};
    const coverage=Number(data.audit.modelCoveragePct||0);
    data.audit.decisionReady=coverage===100&&Boolean(data.audit.trackAssumption);
  }
  data.version=VERSION;
  data.scoreMutation=false;
  return data;
}

async function repairStoredRevision(db,revisionId,evidence){
  if(!revisionId)return null;
  const row=await first(db,'SELECT audit_json FROM lab_user_mark_revisions WHERE revision_id=?',[revisionId]);
  if(!row?.audit_json)return null;
  let stored;try{stored=JSON.parse(row.audit_json)}catch{return null}
  await enrichAudit(db,stored,evidence);
  const auditJson=stable(stored);
  const auditSha256=await sha256(auditJson);
  await db.prepare('UPDATE lab_user_mark_revisions SET identity_basis=?,audit_json=?,audit_sha256=? WHERE revision_id=?')
    .bind(stored.identityBasis||'official-numbered-card-evidence-verified',auditJson,auditSha256,revisionId).run();
  return{audit:stored.audit,auditSha256,identityBasis:stored.identityBasis};
}

async function handleMarkRequest(request,env,ctx){
  const body=await parseBodyClone(request);
  let evidence=null;
  if(body)evidence=await verifyOfficialCardEvidence(env.DB,body);
  if(body&&['post_draw','final'].includes(String(body.phase||''))&&!evidence){
    return json({ok:false,version:VERSION,error:'post_draw/final marks require a verified official numbered card',scoreMutation:false},409);
  }
  const response=await app.fetch(request,env,ctx);
  let data;try{data=await response.json()}catch{return response}
  await enrichAudit(env.DB,data,evidence);
  if(response.ok&&data?.revisionId){
    const repaired=await repairStoredRevision(env.DB,data.revisionId,evidence);
    if(repaired){data.audit=repaired.audit;data.auditSha256=repaired.auditSha256;data.identityBasis=repaired.identityBasis;}
  }
  return json(data,response.status);
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
    if(url.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'user marks x verified official-card evidence'});
    if(url.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'user-mark-official-evidence-hardening',now:new Date().toISOString()});
    if(url.pathname==='/v1/lab/user-mark-capabilities')return json({
      ok:true,version:VERSION,phases:['initial','post_draw','final'],marks:['◎','○','▲','△','☆','注','消'],
      writeProtection:'Bearer secret + confirm=SAVE',writeReady:Boolean(env.USER_MARK_WRITE_TOKEN),
      principles:{humanMarksAreIndependentInput:true,scoreMutation:false,officialCardRequiredForPostDrawAndFinal:true,officialCardEvidenceRequired:true,initialCanUseIsolatedPrecardNames:true,horseNumbersNeverInferredBeforeOfficialCard:true,auditSnapshotPersistedWithRevision:true,nullEvidenceNeverPresentedAsZero:true}
    });
    if(!env.DB)return json({ok:false,version:VERSION,error:'D1 DB missing'},500);
    try{
      if((url.pathname==='/v1/lab/user-mark-audit'||url.pathname==='/v1/lab/user-marks')&&request.method==='POST')return await handleMarkRequest(request,env,ctx);
      return app.fetch(request,env,ctx);
    }catch(error){
      return json({ok:false,version:VERSION,error:String(error?.message||error),scoreMutation:false},/official|Prospective LOCK/.test(String(error))?409:500);
    }
  },
  async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};
