import {sha256} from './card-evidence.js';
import {targetInput} from './race-history-assessment-v3.31.0.js';
const TABLE='lab_provisional_predictions_v1';
const key=t=>`${t.date}:${t.venue}:${t.raceNo}`;
export function provisionalStorageKey(input){
 const base=key(targetInput(input));if(!input.basis)return base;
 if(input.basis!=='confirmed-predraw'||!/^[a-f0-9]{64}$/.test(input.sourceSha256||''))throw Error('枠順前の保存版を指定してください。');
 return base+':predraw:'+input.sourceSha256;
}
export async function readProvisionalPrediction(db,input,{exact=false}={}){
 const t=targetInput(input),storageKey=provisionalStorageKey(input);let row;
 try{row=input.basis||exact?await db.prepare(`SELECT * FROM ${TABLE} WHERE race_key=? ORDER BY saved_at DESC,rowid DESC LIMIT 1`).bind(storageKey).first():await db.prepare(`SELECT * FROM (SELECT * FROM ${TABLE} WHERE race_key=? UNION ALL SELECT * FROM ${TABLE} WHERE race_key>=? AND race_key<?) ORDER BY CASE WHEN instr(race_key,':predraw:')>0 THEN 0 ELSE 1 END,saved_at DESC LIMIT 1`).bind(storageKey,storageKey+':predraw:',storageKey+':predraw;').first();}
 catch(e){if(/no such table/i.test(String(e)))return{ok:true,available:false};throw e;}
 if(!row)return{ok:true,available:false};
 if(await sha256(row.snapshot_json)!==row.snapshot_sha256)throw Error('暫定評価の保存ハッシュが一致しません。');
 const snapshot=JSON.parse(row.snapshot_json);
 if(input.basis&&(snapshot.preparation?.stage!=='entries-confirmed-predraw'||snapshot.preparation?.sourceSha256!==input.sourceSha256))throw Error('枠順前の保存版が一致しません。');
 if(key(snapshot.race)!==key(t)||snapshot.guardrails?.officialCard!==false||snapshot.guardrails.locked!==false||snapshot.guardrails.eligibleForLearning!==false||snapshot.guardrails.persisted!==true||snapshot.savedAt!==row.saved_at)throw Error('暫定評価の保存対象・状態が一致しません。');
 return{ok:true,available:true,integrityVerified:true,snapshotSha256:row.snapshot_sha256,snapshot};
}
export async function saveProvisionalPrediction(db,input,build,now=Date.now()){
 const t=targetInput(input),today=new Date(now+9*3600000).toISOString().slice(0,10);
 if(t.date<=today)throw Error('新規の暫定保存は翌日以降の開催に限定します。');
 // A saved provisional snapshot is never silently regenerated on retries.
 const storageKey=provisionalStorageKey(input),existing=await readProvisionalPrediction(db,input,{exact:true});if(existing.available)return{...existing,saved:0};
 const result=await build();
 if(!result?.ok||result.status!=='provisional-expected-roster'||key(result.race)!==key(t)||result.guardrails?.humanMarksUsed!==false||result.guardrails.officialCard!==false||result.guardrails.locked!==false||result.guardrails.eligibleForLearning!==false||!result.runners?.length||result.runners.length!==result.runnerCount||result.runners.some(r=>r.horseNo!==null||r.frameNo!==null))throw Error('暫定評価の生成内容を確認できません。');
 if(input.basis&&(result.preparation?.stage!=='entries-confirmed-predraw'||result.preparation?.sourceSha256!==input.sourceSha256))throw Error('枠順前の入力版と評価が一致しません。');
 const snapshot={...result,savedAt:new Date(now).toISOString(),guardrails:{...result.guardrails,persisted:true}},body=JSON.stringify(snapshot),hash=await sha256(body);
 await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE}(race_key TEXT PRIMARY KEY,snapshot_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL,saved_at TEXT NOT NULL)`).run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS provisional_prediction_no_${action.toLowerCase()} BEFORE ${action} ON ${TABLE} BEGIN SELECT RAISE(ABORT,'provisional snapshot is immutable'); END`).run();
 try{
 const wrote=await db.prepare(`INSERT OR IGNORE INTO ${TABLE} VALUES(?,?,?,?)`).bind(storageKey,hash,body,snapshot.savedAt).run();
 const read=await readProvisionalPrediction(db,input,{exact:true});if(!read.available)throw Error('暫定評価の保存後読返しに失敗しました。');
 if(Number(wrote.meta?.changes)===1&&(read.snapshotSha256!==hash||JSON.stringify(read.snapshot)!==body))throw Error('暫定評価の保存後内容が一致しません。');
 return{...read,saved:Number(wrote.meta?.changes)===1?1:0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
