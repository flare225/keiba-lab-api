import {postRaceHistoryBatch} from './post-race-history-batch.js';
import {assessmentContext,officialHistoryEvidence,targetInput} from './race-history-assessment-v3.31.0.js';
import {sha256} from './card-evidence.js';
import {jstDay} from './history-collection-v3.37.0.js';
const TABLE='lab_post_race_assessments_v1',MODEL='existing-safe-core-1.5-recent-three-v1';
async function ensure(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(snapshot_sha256 TEXT PRIMARY KEY,race_key TEXT NOT NULL,model_version TEXT NOT NULL,track_key TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL)`).run();
 await db.prepare(`CREATE INDEX IF NOT EXISTS post_race_assessment_race ON ${TABLE}(race_key,created_at)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS post_assessment_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'post-race assessment is immutable'); END`).run();
}
const flags=()=>({postRace:true,preRacePrediction:false,targetResultUsed:false,humanMarksUsedInScore:false,eligibleForProspectiveAccuracy:false,eligibleForFrozenValidation:false,automaticTraining:false,externalRequests:0});
export async function readPostRaceAssessments(db,input){
 const t=targetInput(input),key=`${t.date}:${t.venue}:${t.raceNo}`;let rows;
 try{rows=(await db.prepare(`SELECT * FROM ${TABLE} WHERE race_key=? ORDER BY created_at DESC,rowid DESC LIMIT 10`).bind(key).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return[];throw e;}
 return Promise.all(rows.map(async r=>{if(await sha256(r.snapshot_json)!==r.snapshot_sha256)throw Error('事後評価の保存内容が一致しません。');const snapshot=JSON.parse(r.snapshot_json);if(snapshot.phase!=='post-race-review'||snapshot.race.raceKey!==key||snapshot.guardrails?.eligibleForProspectiveAccuracy!==false||snapshot.guardrails?.preRacePrediction!==false)throw Error('事後評価の区分が一致しません。');return{snapshotSha256:r.snapshot_sha256,createdAt:r.created_at,...snapshot};}));
}
export async function capturePostRaceAssessment(db,input,now=Date.now()){
 const t=targetInput(input);if(t.date>=jstDay(now))throw Error('事後評価の保存対象は前日以前のレースです。');
 const track=input.track||null;if(track&&!['良','稍重','重','不良'].includes(track))throw Error('想定馬場を確認してください。');
 const context=await assessmentContext(db,t);if(!context.official)throw Error('正式出馬表が未保存です。');
 if(new Set(context.runners.map(r=>Number(r.horse_no))).size!==context.runners.length||context.runners.some(r=>!Number.isInteger(Number(r.horse_no))||Number(r.horse_no)<1||Number(r.horse_no)>18))throw Error('出馬表の馬番を照合できません。');
 const {histories,all}=await officialHistoryEvidence(db,context,track,await postRaceHistoryBatch(db,context));
 const marks={1:'◎',2:'○',3:'▲',4:'△',5:'☆'};
 const snapshot={phase:'post-race-review',label:'事後LABO参考印（回顧用）',modelVersion:MODEL,race:{raceKey:context.raceKey,date:t.date,venue:t.venue,raceNo:t.raceNo,raceName:context.raceName,runnerCount:all.length},trackAssumption:track,trackBasis:track?'explicit-review-scenario':'unknown',scoredRunners:all.filter(r=>r.assessment.available).length,runners:all.map(r=>({horseNo:r.horseNo,horseName:r.horseName,rank:r.referenceRank,tiedCount:r.tiedCount,mark:r.referenceRank==null?null:marks[r.referenceRank]||null,score:r.assessment.evidenceScore,assessment:r.assessment})),histories,guardrails:flags()};
 const body=JSON.stringify(snapshot),hash=await sha256(body);await ensure(db);
 try{
 const result=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?,?,?,?)`).bind(hash,context.raceKey,MODEL,track||'unknown',body,new Date(now).toISOString()).run();
 const row=await db.prepare(`SELECT snapshot_json,created_at FROM ${TABLE} WHERE snapshot_sha256=?`).bind(hash).first();
 if(!row||row.snapshot_json!==body||await sha256(row.snapshot_json)!==hash)throw Error('事後評価のDB保存を確認できません。再書込せず保留します。');
 return{ok:true,status:'post-race-assessment-saved',idempotent:Number(result.meta?.changes)!==1,snapshotSha256:hash,createdAt:row.created_at,...snapshot};
 }catch(error){error.saveMayHaveSucceeded=true;throw error;}
}
export function postRaceAssessmentPage(records=[]){
 const esc=x=>String(x??'未取得').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>事後LABO参考印</title><style>body{background:#0b141e;color:#edf4ff;font:16px sans-serif;max-width:720px;margin:auto;padding:20px}article{border:1px solid #456;padding:12px;margin:12px 0;border-radius:10px}p{overflow-wrap:anywhere}a{color:#8cf}</style><a href="https://keiba-lab-apl.vercel.app/">LABOへ戻る</a><h1>事後LABO参考印・回顧用</h1><p>事前予想ではありません。作成時点の保存済み過去走から再評価した参考記録です。事前的中率・固定検証・自動学習には加算しません。最終印・LOCKは変更しません。</p>'+(!records.length?'<p>保存済みの事後評価はありません。</p>':records.map(x=>'<section><h2>'+esc(x.race.date+' '+x.race.venue+x.race.raceNo+'R')+'</h2><p>作成 '+esc(x.createdAt)+' ／ 評価可能 '+x.scoredRunners+'/'+x.race.runnerCount+'頭 ／ 馬場想定 '+esc(x.trackAssumption||'未指定')+'</p>'+x.runners.map(r=>'<article><b>'+esc(r.mark||'—')+' '+esc(r.horseNo)+'番 '+esc(r.horseName)+'</b><p>参考順位 '+esc(r.rank)+' ／ 指数 '+esc(r.score)+(r.tiedCount>1?' ／ 同点 '+r.tiedCount+'頭':'')+'</p></article>').join('')+'</section>').join(''))+'</html>';
}
