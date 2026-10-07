export const EXPECTED_SOURCES = [{
 raceKey:'2026-10-10:東京:11',date:'2026-10-10',venue:'東京',raceNo:11,
 raceName:'サウジアラビアロイヤルカップ',surface:'芝',distance:1600,age:2,
 snapshotId:'netkeiba-saudi-20261005-v1',provider:'netkeiba',sourcePublishedAt:'2026-10-05T12:00:00+09:00',
 observedAt:'2026-10-06T04:13:11Z',
 sourceUrl:'https://own.netkeiba.com/news/news_detail.html?id=344704',
 corroboratingUrl:'https://race.netkeiba.com/race/shutuba.html?race_id=202605040311&rf=shutuba_submenu',
 names:['アイファーマーリン','アゴルディーノ','ギブリ','グルーヴェンス','サトノハクマイ','ジップスパーク','デミアン','ニシノトラノスケ','ハンサム','フィリオソラーレ','ベルウッドディープ','ライーリーアース']
}];
export const MAIN_EXPECTED_SOURCE={
 raceKey:'2026-10-11:東京:11',date:'2026-10-11',venue:'東京',raceNo:11,raceName:'アイルランドトロフィー',surface:'芝',distance:1800,
 snapshotId:'netkeiba-ireland-20261007-v1',provider:'netkeiba',sourcePublishedAt:null,observedAt:'2026-10-06T23:30:00Z',priority:0,
 sourceUrl:'https://race.netkeiba.com/race/shutuba.html?race_id=202605040411',corroboratingUrl:'https://www.jra.go.jp/keiba/race/093/horse.html',officialHorsePage:'https://www.jra.go.jp/keiba/race/093/horse.html',
 sourceNotice:'10月7日に確認した登録一覧18頭。出走確定・枠順は未確認です。JRAの出走馬情報は全登録馬の一覧ではありません。',
 ages:{'ウイントワイライト':4,'ヴォンフレ':4,'カネラフィーナ':4,'カムニャック':4,'クイーンズウォーク':5,'クランフォード':5,'ジョスラン':4,'セキトバイースト':5,'チェルビアット':4,'テリオスララ':4,'ニシノティアモ':5,'ハワイアンティアレ':5,'ミアネーロ':5,'ミラビリスマジック':5,'ムイ':4,'ラヴァンダ':5,'ルージュソリテール':4,'ワタシマツワ':4}
};
MAIN_EXPECTED_SOURCE.names=Object.keys(MAIN_EXPECTED_SOURCE.ages);
EXPECTED_SOURCES.push(MAIN_EXPECTED_SOURCE);
export function expectedAge(source,name){const age=Number(source.ages?.[name]??source.age);if(!Number.isInteger(age)||age<2||age>20)throw Error('想定馬の年齢を確認できません。');return age;}
const MARKS = ['◎','○','▲','△','☆','注','消'];
export const PREVIEW_GUARDS={readOnly:true,scoreMutation:false,markMutation:false,authoritativeForCard:false,eligibleForProspectiveSeal:false,horseNumbersNeverInferred:true,targetResultsExcluded:true,oddsAndPopularityExcluded:true,sourceIsDatedSnapshot:true};
export function sourceFor(input={}){
 const raceNo=Number(input.raceNo??input.race_no);
 const source=EXPECTED_SOURCES.find(s=>s.date===input.date&&s.venue===input.venue&&s.raceNo===raceNo);
 if(!source)throw new Error('対応する想定馬一覧がありません。対象日・競馬場・レースを確認してください。');
 return source;
}
export function validatePreview(input={}){
 const source=sourceFor(input);
 if(input.phase&&input.phase!=='initial')throw new Error('想定馬の仮比較は初期印のみ対応しています。');
 if(input.sourceSnapshotId&&input.sourceSnapshotId!==source.snapshotId)throw new Error('想定馬一覧が更新されています。画面を開き直してください。');
 if(!Array.isArray(input.marks)||!input.marks.length||input.marks.length>18)throw new Error('印を1頭以上、18頭以下で指定してください。');
 const seen=new Set();
 const marks=input.marks.map(m=>{
  if(m.horseNo!=null)throw new Error('想定馬は馬名で指定してください。馬番は未確定です。');
  const horseName=String(m.horseName||'').trim(),mark=String(m.mark||'');
  if(!source.names.includes(horseName))throw new Error('最新の想定馬一覧にない馬名です：'+horseName);
  if(!MARKS.includes(mark))throw new Error('印が不正です。');
  if(seen.has(horseName))throw new Error('同じ馬が重複しています：'+horseName);
  seen.add(horseName);return{horseName,mark,horseNo:null};
 });
 return{source,marks};
}
const number=value=>value==null||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
function seconds(value){
 if(value==null||value==='')return null;
 const text=String(value).trim(),m=text.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
 return m?Number(m[1])*60+Number(m[2]):number(value);
}
async function query(db,sql,args,source,warnings){
 try{return (await db.prepare(sql).bind(...args).all()).results||[]}
 catch(error){
  if(/no such table/i.test(String(error?.message||error))){warnings.push(source+'-table-unavailable');return[]}
  throw new Error('過去DBの照会に失敗しました（'+source+'）。履歴ゼロとは判定していません。');
 }
}
export async function historyForExpected(db,source,horseName,limit=8){
 const age=expectedAge(source,horseName),beforeDate=source.date,fromDate=String(Number(beforeDate.slice(0,4))-age+2)+'-01-01',warnings=[];
 const cap=Math.max(1,Math.min(8,Number(limit)||8));
 const rich=await query(db,
  'SELECT r.race_date,r.venue,r.race_name,r.surface,r.distance,r.runner_count AS field_size,COALESCE(d.finish_position,o.finish_position) AS finish_position,d.finish_status,d.time_text,d.time_seconds,d.corner_positions,d.last3f,d.source_url FROM jra_runners x JOIN jra_races r ON r.race_key=x.race_key LEFT JOIN lab_race_outcomes o ON o.race_key=x.race_key AND o.horse_no=x.horse_no LEFT JOIN lab_race_result_details d ON d.race_key=x.race_key AND d.horse_no=x.horse_no WHERE x.horse_name=? AND x.age=(? - (CAST(strftime(\'%Y\',?) AS INTEGER)-CAST(strftime(\'%Y\',r.race_date) AS INTEGER))) AND r.race_date>=? AND r.race_date<? ORDER BY r.race_date DESC,r.race_no DESC LIMIT 20',
  [horseName,age,beforeDate,fromDate,beforeDate],'official-result',warnings);
 const profiles=await query(db,
  'SELECT race_date,venue,race_name,surface,distance,finish_position,field_size,time_text,last3f,corner_positions,track_condition,source_url FROM jra_past_performances WHERE horse_name=? AND race_date>=? AND race_date<? ORDER BY race_date DESC LIMIT 20',
  [horseName,fromDate,beforeDate],'stored-profile-history',warnings);
 const expectedStored=source.snapshotId==='no-expected-supplement'?[]:await query(db,'SELECT payload_json FROM lab_expected_history_snapshots WHERE snapshot_id=? AND horse_name=? AND race_date>=? AND race_date<? ORDER BY race_date DESC LIMIT 20',[source.snapshotId,horseName,fromDate,beforeDate],'netkeiba-history',warnings);
 const expected=expectedStored.map(r=>{try{return JSON.parse(r.payload_json)}catch{throw Error('過去DBの保存データを読み込めません。')}});
 const valid=r=>typeof r.race_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.race_date)&&r.race_date>=fromDate&&r.race_date<beforeDate;
 const byRace=new Map();let conflict=false;
 for(const raw of [...expected.map(r=>({...r,dbSource:'netkeiba-dated-history'})),...profiles.map(r=>({...r,dbSource:'stored-profile-history'})),...rich.map(r=>({...r,dbSource:'official-result'}))].filter(valid)){
  const row={date:raw.race_date,venue:raw.venue||null,raceName:raw.race_name||null,surface:raw.surface||null,distance:number(raw.distance),fieldSize:number(raw.field_size),finish:number(raw.finish_position),finishStatus:raw.finish_status||null,time:raw.time_text||null,timeSeconds:number(raw.time_seconds)??seconds(raw.time_text),last3f:number(raw.last3f),cornerPositions:raw.corner_positions||null,trackCondition:raw.track_condition||null,sourceUrl:raw.source_url||null,supplementalSourceUrl:raw.dbSource==='netkeiba-dated-history'?raw.source_url||null:null,dbSource:raw.dbSource};
  const key=row.date+'|'+row.venue;
  const old=byRace.get(key);
  if(old){
   for(const field of ['finish','surface','distance'])if(old[field]!=null&&row[field]!=null&&old[field]!==row[field])conflict=true;
   for(const [field,value] of Object.entries(row))if(value!=null)old[field]=value;
   old.dbSource=[...new Set([old.dbSource,row.dbSource])].join('+');
  }else byRace.set(key,row);
 }
 const recent=[...byRace.values()].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,cap);
 if(conflict)warnings.push('conflicting-history-identity');
 const finished=recent.filter(r=>Number.isInteger(r.finish)&&r.finish>0);
 const last3fs=recent.map(r=>r.last3f).filter(v=>v!=null&&v>0);
 const sameCondition=finished.filter(r=>r.surface===source.surface&&r.distance===source.distance);
 const round=v=>Math.round(v*100)/100;
 const summary=conflict?null:{
  storedStarts:recent.length,finishedStarts:finished.length,
  wins:finished.length?finished.filter(r=>r.finish===1).length:null,
  top3:finished.length?finished.filter(r=>r.finish<=3).length:null,
  avgFinish:finished.length?round(finished.reduce((s,r)=>s+r.finish,0)/finished.length):null,
  avgLast3f:last3fs.length?round(last3fs.reduce((a,b)=>a+b,0)/last3fs.length):null,
  last3fRecorded:last3fs.length,
  sameSurfaceDistanceStarts:sameCondition.length,
  sameSurfaceDistanceTop3:sameCondition.length?sameCondition.filter(r=>r.finish<=3).length:null
 };
 if(!recent.length)warnings.push('no-stored-prior-history');
 else if(finished.length<3)warnings.push('sparse-prior-history');
 if(last3fs.length<recent.length)warnings.push('last3f-incomplete');
 return{horseName,beforeDate,fromDate,antiLeakageRule:'from_date <= race_date < target_date',
  identityBasis:'exact-horse-name + age-consistent-birth-cohort-window',
  available:!conflict&&recent.length>0,summary,recent:conflict?[]:recent,warnings};
}
export async function expectedRunnerPreview(db,input={}){
 const {source,marks}=validatePreview(input);
 if(!db?.prepare)throw new Error('過去DBへ接続できません。');
 const historySidecar=[];
 for(const mark of marks)historySidecar.push(await historyForExpected(db,source,mark.horseName));
 return{ok:true,stage:'expected-runner-db-preview',phase:'initial',
  race:{raceKey:source.raceKey,date:source.date,venue:source.venue,raceNo:source.raceNo,raceName:source.raceName,surface:source.surface,distance:source.distance},
  source:{provider:source.provider,url:source.sourceUrl,corroboratingUrl:source.corroboratingUrl,publishedAt:source.sourcePublishedAt,observedAt:source.observedAt,snapshotId:source.snapshotId,runnerCount:source.names.length,dynamicRefresh:false,authoritativeForCard:false},
  identityBasis:'netkeiba-expected-non-authoritative',
  scoreMutation:false,
  audit:{mode:'expected-context-only',marked:marks.map(m=>({...m,laboRank:null,laboScore:null})),historySidecar,guardrails:PREVIEW_GUARDS},
  guardrails:PREVIEW_GUARDS};
}

