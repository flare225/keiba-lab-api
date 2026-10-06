export const REVIEW_PHASES={initial:'初期印',post_draw:'枠順後の見直し',race_day:'当日の見直し'};
export const MAX_CHECKPOINTS=20;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export const reviewRaceKey=t=>t.date+':'+t.venue+':'+Number(t.raceNo);
export const reviewDay=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
export function reviewPhaseReason(phase,meta,date,stamp=Date.now()){
 if(!Object.hasOwn(REVIEW_PHASES,phase))return '記録の段階を確認してください。';
 if(phase!=='initial'&&!meta?.frameVerified)return '枠順後・当日の記録には、全馬の枠番を照合した正式出馬表が必要です。';
 if(phase==='race_day'&&reviewDay(stamp)!==date)return '当日の見直しは、対象レースの開催日に記録できます。';
 return null;
}
export function makeCheckpoint(target,data,marks,phase='initial',stamp=Date.now()){
 const meta=data.reviewMeta||target.reviewMeta||{},error=reviewPhaseReason(phase,meta,target.date,stamp);if(error)throw Error(error);
 if(!data.ok||data.race?.date!==target.date||data.race?.venue!==target.venue||Number(data.race?.raceNo)!==Number(target.raceNo))throw Error('比較結果と記録対象のレースが一致しません。');
 const a=data.assessment,all=a?.allRunners;if(!all?.length||all.length>18||all.length!==a.runnerPool||new Set(all.map(r=>r.horseName)).size!==all.length)throw Error('全馬の比較結果を確認できません。');
 if(!marks.length||marks.some(m=>!all.some(r=>r.horseName===m.horseName)||!['◎','○','▲','△','☆','注','消'].includes(m.mark))||new Set(marks.map(m=>m.horseName)).size!==marks.length)throw Error('記録する初期印を確認してください。');
 const today=reviewDay(stamp),roster=new Map((meta.roster||[]).map(r=>[r.horseName,r]));
 return{schemaVersion:1,id:String(stamp)+'-'+phase+'-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)),raceKey:reviewRaceKey(target),capturedAt:new Date(stamp).toISOString(),phase,track:a.trackAssumption||null,trackConfirmed:false,source:{official:Boolean(meta.official),frameVerified:Boolean(meta.frameVerified),sourceSha256:meta.sourceSha256||null,sourceFetchedAt:meta.sourceFetchedAt||null,snapshotId:meta.snapshotId||target.snapshotId||null},runnerPool:a.runnerPool,scoredRunners:a.scoredRunners,modelVersion:a.modelVersion||null,marks:marks.map(m=>({horseName:m.horseName,mark:m.mark})),rows:all.map(r=>({horseName:r.horseName,horseNo:meta.official?(roster.get(r.horseName)?.horseNo??r.horseNo??null):null,frameNo:meta.frameVerified?(roster.get(r.horseName)?.frameNo??null):null,score:finite(r.assessment.evidenceScore)?r.assessment.evidenceScore:null,referenceRank:finite(r.referenceRank)?r.referenceRank:null,tiedCount:r.tiedCount||0,validFinishRows:r.assessment.validFinishRows,components:{...r.assessment.components}})),retrospective:today>target.date,capturedBeforeRaceDay:today<target.date,eligibleForAccuracyEvaluation:false,officialMarkRevision:false};
}
export function readCheckpoints(raw,raceKey){
 if(!raw)return [];let value;try{value=JSON.parse(raw);}catch{throw Error('保存済みの比較記録を読み込めません。上書きせず保留しています。');}
 if(!Array.isArray(value))throw Error('比較記録の形式を確認できません。上書きせず保留しています。');
 if(value.some(s=>s?.schemaVersion!==1||s.raceKey!==raceKey||!Object.hasOwn(REVIEW_PHASES,s.phase)||typeof s.id!=='string'||!Number.isFinite(Date.parse(s.capturedAt))||!Array.isArray(s.rows)||!Array.isArray(s.marks)||s.rows.length<1||s.rows.length>18||s.rows.length!==s.runnerPool||new Set(s.rows.map(r=>r.horseName)).size!==s.rows.length||s.rows.some(r=>typeof r.horseName!=='string'||(r.score!==null&&!finite(r.score)))||s.marks.some(m=>!s.rows.some(r=>r.horseName===m.horseName)||!['◎','○','▲','△','☆','注','消'].includes(m.mark))))throw Error('保存済みの比較記録を検証できません。上書きせず保留しています。');
 return value.slice(-MAX_CHECKPOINTS);
}
export function appendCheckpoint(history,snapshot){
 const old=history.at(-1),same=old&&JSON.stringify({...old,id:null,capturedAt:null})===JSON.stringify({...snapshot,id:null,capturedAt:null});
 if(same)return [...history];return [...history,snapshot].slice(-MAX_CHECKPOINTS);
}
export function compareCheckpoints(previous,current){
 if(previous.raceKey!==current.raceKey)throw Error('同じレースの記録を選んでください。');
 const before=new Map(previous.rows.map(r=>[r.horseName,r])),after=new Map(current.rows.map(r=>[r.horseName,r])),marksBefore=new Map(previous.marks.map(m=>[m.horseName,m.mark])),marksAfter=new Map(current.marks.map(m=>[m.horseName,m.mark]));
 const names=[...new Set([...before.keys(),...after.keys()])],rosterChanged=names.some(n=>!before.has(n)||!after.has(n)),rankComparable=!rosterChanged&&previous.scoredRunners===previous.runnerPool&&current.scoredRunners===current.runnerPool&&previous.modelVersion===current.modelVersion;
 const changes=names.map(horseName=>{const a=before.get(horseName),b=after.get(horseName);return{horseName,before:a||null,after:b||null,markBefore:marksBefore.get(horseName)||null,markAfter:marksAfter.get(horseName)||null,participation:!a?'追加':!b?'現在の一覧に不在':'継続',scoreDelta:a&&b&&finite(a.score)&&finite(b.score)?Math.round((b.score-a.score)*10)/10:null,rankComparable,changed:!a||!b||a.score!==b.score||a.referenceRank!==b.referenceRank||a.frameNo!==b.frameNo||a.horseNo!==b.horseNo||a.validFinishRows!==b.validFinishRows||marksBefore.get(horseName)!==marksAfter.get(horseName)};});
 return{changes,rosterChanged,rankComparable,trackChanged:previous.track!==current.track,sourceChanged:JSON.stringify(previous.source)!==JSON.stringify(current.source),notice:rosterChanged?'出走馬の一覧が変わっています。順位をそのまま比較しません。':!rankComparable?'全馬の評価条件がそろっていないため、順位差の判断は保留します。':'同じ出走馬の一覧で参考順位を比較しています。',frameScoreNotice:'枠順は見直しの材料として表示。現在の参考指数には枠順・展開・追い切りを反映していません。'};
}
