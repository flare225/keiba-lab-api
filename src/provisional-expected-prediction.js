import {parseProgramLabel} from './archive-program-parser-v3.38.0.js';
import {assessExpectedHistory,rankAssessment} from './expected-assessment-v3.31.0.js';
import {historyForExpected,expectedAge} from './expected-runner-preview-v3.30.0.js';
import {postRaceHistoryBatch} from './post-race-history-batch.js';

// Expected entries are identities, never official horse/frame numbers.
export function buildProvisionalPrediction(source,conditions,histories,now=Date.now()){
 const today=new Date(now+9*3600000).toISOString().slice(0,10);
 if(source.date<=today)throw Error('暫定生成は翌日以降の開催に限定します。');
 if(!['芝','ダート','障害'].includes(conditions?.surface)||!Number.isInteger(Number(conditions?.distance))||Number(conditions.distance)<=0)throw Error('保存済み番組のコース・距離を確認できません。');
 const race={date:source.date,venue:source.venue,surface:conditions.surface,distance:Number(conditions.distance)};
 const rows=rankAssessment(source.names.map(horseName=>({horseName,horseNo:null,frameNo:null,assessment:assessExpectedHistory(histories.get(horseName),race,null,'recent-three-v1')})));
 const marks=['◎','○','▲','△','☆'];
 for(const row of rows){row.score=row.assessment.evidenceScore;row.rank=row.referenceRank;row.mark=row.rank===null?null:(marks[row.rank-1]||'注');}
 return {ok:true,status:'provisional-expected-roster',generatedAt:new Date(now).toISOString(),modelVersion:'existing-safe-core-1.5-recent-three-v1',race:{...race,raceNo:source.raceNo,raceName:source.raceName},roster:{snapshotId:source.snapshotId,sourceUrl:source.sourceUrl,observedAt:source.observedAt},conditionsSourceUrl:conditions.source_url,runnerCount:rows.length,scoredRunners:rows.filter(r=>r.rank!==null).length,runners:rows,histories:source.names.map(name=>histories.get(name)),guardrails:{humanMarksUsed:false,officialCard:false,horseNumbersAssigned:false,locked:false,persisted:false,eligibleForLearning:false,targetResultUsed:false,noForcedTieBreak:true,externalRequests:0},notice:'想定名簿による暫定参考評価。登録除外・取消・枠順は未反映。同点は同順位・同じ印。netkeiba由来の履歴はJRA公式照合済みではありません。'};
}
export async function provisionalExpectedPrediction(db,source,now=Date.now()){
 if(!source)throw Error('想定名簿が保存されていません。');
 // Stop before expensive history reads for old targets or incomplete programs.
 const today=new Date(now+9*3600000).toISOString().slice(0,10);
 if(source.date<=today)throw Error('暫定生成は翌日以降の開催に限定します。');
 const conditions=await db.prepare('SELECT surface,distance,source_url FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=?').bind(source.date,source.venue,source.raceNo).first();
 if(!conditions?.surface||!conditions?.distance)throw Error('保存済み番組のコース・距離を確認できません。');
 const context={...source,runners:source.names.map(horse_name=>({horse_name,age:expectedAge(source,horse_name)}))};
 const batch=await postRaceHistoryBatch(db,context),histories=new Map();
 for(const name of source.names)histories.set(name,await historyForExpected(db,source,name,8,batch.get(name)));
 return buildProvisionalPrediction(source,conditions,histories,now);
}

// Repair only absent conditions, using the stored official program label.
export async function repairStoredProgramConditions(db,source){
 const args=[source.date,source.venue,source.raceNo];
 const row=await db.prepare('SELECT race_label,surface,distance,source_url FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=?').bind(...args).first();
 if(!row||row.surface&&row.distance)return{repaired:0};
 let url;try{url=new URL(row.source_url)}catch{return{repaired:0,reason:'official-source-unconfirmed'}};
 if(url.protocol!=='https:'||url.hostname!=='www.jra.go.jp')return{repaired:0,reason:'official-source-unconfirmed'};
 const parsed=parseProgramLabel(row.race_label);
 if(!parsed.surface||!parsed.distance||row.surface&&row.surface!==parsed.surface||row.distance&&Number(row.distance)!==parsed.distance)return{repaired:0,reason:'stored-label-insufficient-or-conflicting'};
 const result=await db.prepare("UPDATE jra_race_program SET surface=COALESCE(NULLIF(surface,''),?),distance=COALESCE(distance,?) WHERE race_date=? AND venue=? AND race_no=? AND (surface IS NULL OR surface='' OR distance IS NULL)").bind(parsed.surface,parsed.distance,...args).run();
 const read=await db.prepare('SELECT surface,distance FROM jra_race_program WHERE race_date=? AND venue=? AND race_no=?').bind(...args).first();
 if(read?.surface!==parsed.surface||Number(read.distance)!==parsed.distance)throw Error('番組条件の補完後読返しが一致しません。');
 return{repaired:Number(result.meta?.changes)||0,sourceUrl:row.source_url,sourceLabel:row.race_label,readbackVerified:true};
}
