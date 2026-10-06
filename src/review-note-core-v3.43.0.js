export const MEMO_KEY='keiba-labo:review-memos:v1';
export const MEMO_FIELDS={overview:'レース全体',axis:'軸馬の振り返り',track:'馬場',position:'展開・位置取り',gap:'予想とのズレ・次の確認点'};
export const memoRaceKey=r=>r.date+':'+r.venue+':'+Number(r.raceNo);
const clean=v=>String(v??'').replace(/\r/g,'').trim();
export function parseMemoStore(raw){
 if(!raw)return {};let value;try{value=JSON.parse(raw);}catch{throw Error('保存済みメモを読み込めません。上書きせず保留しています。');}
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length>100)throw Error('保存済みメモの形式を確認できません。');
 for(const [key,m] of Object.entries(value))if(!m||m.schemaVersion!==1||m.raceKey!==key||!/^\d{4}-\d{2}-\d{2}$/.test(m.raceDate)||!Number.isFinite(Date.parse(m.updatedAt))||!m.fields||Object.keys(MEMO_FIELDS).some(k=>typeof m.fields[k]!=='string'||m.fields[k].length>2000)||!Array.isArray(m.watch)||m.watch.length>18||new Set(m.watch.map(w=>w?.horseName)).size!==m.watch.length||m.watch.some(w=>typeof w?.horseName!=='string'||!w.horseName||w.horseName.length>80||typeof w.note!=='string'||!w.note||w.note.length>500))throw Error('保存済みメモを検証できません。上書きせず保留しています。');
 return value;
}
export function createMemo(race,fields,watch,stamp=Date.now()){
 const normalized=Object.fromEntries(Object.keys(MEMO_FIELDS).map(k=>[k,clean(fields[k])])),names=new Set((race.names||[]));
 if(Object.values(normalized).some(v=>v.length>2000)||watch.length>18||new Set(watch.map(w=>w.horseName)).size!==watch.length||watch.some(w=>!names.has(w.horseName)||!clean(w.note)||clean(w.note).length>500))throw Error('メモの長さ・対象馬・重複を確認してください。');
 if(!Object.values(normalized).some(Boolean)&&!watch.length)throw Error('回顧メモか次走注目メモを入力してください。');
 return{schemaVersion:1,raceKey:memoRaceKey(race),raceDate:race.date,updatedAt:new Date(stamp).toISOString(),fields:normalized,watch:watch.map(w=>({horseName:w.horseName,note:clean(w.note)})),manualObservation:true,eligibleForAccuracyEvaluation:false};
}
export function storeMemo(registry,memo){
 if(!Object.hasOwn(registry,memo.raceKey)&&Object.keys(registry).length>=100)throw Error('保存上限100レースに達しています。既存メモは保持しています。');
 return{...registry,[memo.raceKey]:memo};
}
export function upcomingWatch(registry,target){
 const names=new Set(target.names||[]);return Object.values(registry).filter(m=>m.raceDate<target.date&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(m.updatedAt))<target.date).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).flatMap(m=>m.watch.filter(w=>names.has(w.horseName)).map(w=>({...w,sourceRaceKey:m.raceKey,sourceDate:m.raceDate,updatedAt:m.updatedAt,identityBasis:'exact-horse-name-only',manualObservation:true}))).slice(0,36);
}
export function priorHumanMarks(history){
 // A same-day timestamp without a verified start-time check is not enough to call marks pre-race.
 return (history.markRevisions||[]).filter(r=>r.createdAt&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.createdAt))<history.race.date&&Array.isArray(r.marked)).at(-1)||null;
}
export function composeReviewArticle(history,memo=null){
 const r=history.race||{},rows=history.runners||[],prediction=history.laboPrediction||{},human=priorHumanMarks(history),lines=[`🏁 ${r.date||''} ${r.venue||''}${r.raceNo||''}R ${r.raceName||''} 回顧`,'','【事前の印】'];
 if(prediction.available&&prediction.hashVerified&&prediction.locked){lines.push('LABO：保存済み事前LOCK');for(const m of prediction.top5||[])lines.push(`${m.mark||''} ${m.horseNo||''}番 ${clean(m.horseName)}`);}else lines.push('LABO：確認できる事前LOCK記録なし');
 if(human){lines.push('自分の印（開催日前にDB保存した記録）');for(const m of human.marked)lines.push(`${m.mark||''} ${m.horseNo==null?'':m.horseNo+'番 '}${clean(m.horseName)}`);}else lines.push('自分の印：開催日前のDB保存記録は未確認');
 lines.push('','【レース結果】',history.result?.complete?'保存済み結果：全馬分':'保存済み結果：未取得・一部未取得の項目あり');
 for(const x of rows){const finish=x.finishPosition!=null?x.finishPosition+'着':x.finishStatus||'着順未取得';lines.push(`${finish} ${x.horseNo||''}番 ${clean(x.horseName)}｜時計 ${x.time||'未取得'}｜通過 ${x.cornerPositions||'未取得'}｜上がり3F ${x.last3f==null?'未取得':x.last3f+'秒'}`);}
 for(const [key,label] of Object.entries(MEMO_FIELDS)){lines.push('',`【${label}】`,memo?.fields?.[key]||'メモ未入力');}
 lines.push('','【次走注目】');if(memo?.watch?.length)for(const w of memo.watch)lines.push(`・${clean(w.horseName)}：${clean(w.note)}`);else lines.push('次走注目メモ未入力');
 if(human||prediction.available&&prediction.hashVerified&&prediction.locked){lines.push('','【保存済みの印と着順】');const ranked=new Map(rows.map(x=>[x.horseName,x]));for(const m of human?.marked||prediction.top5||[]){const x=ranked.get(m.horseName);lines.push(`${m.mark||''} ${clean(m.horseName)} → ${x?.finishPosition!=null?x.finishPosition+'着':x?.finishStatus||'結果未取得'}`);}}
 lines.push('','※回顧メモは手入力の観察です。結果から事前印や指数を書き換えません。');return lines.join('\n').trim();
}
