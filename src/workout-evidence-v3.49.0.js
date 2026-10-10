const DATE=/^20\d\d-\d\d-\d\d$/;
const HEADERS={'content-type':'application/json; charset=UTF-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const query=async(db,sql,bind=[])=>((await db.prepare(sql).bind(...bind).all()).results||[]);
const one=async(db,sql,bind=[])=>await db.prepare(sql).bind(...bind).first();
const missingTable=e=>/no such table/i.test(String(e?.message||e));
export function workoutTarget(x){
 const date=String(x?.date||''),venue=String(x?.venue||''),raceNo=Number(x?.raceNo??x?.race_no);
 if(!DATE.test(date)||venue.length<1||venue.length>20||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw Error('開催日・競馬場・レース番号を確認してください。');
 return{date,venue,raceNo,raceKey:date+':'+venue+':'+raceNo};
}
const types=new Set(['坂路','ウッド','CW','W','ポリ','芝','ダート']);
const seconds=(x,label)=>{
 if(x===null||x===undefined||x==='')return null;
 if(typeof x!=='number'||!Number.isFinite(x)||x<10||x>180)throw Error(label+'の計時値が不正です。');
 return Math.round(x*10)/10;
};
export function normalizeWorkoutBatch(body,target,official){
 if(body?.rightsGranted!==true||typeof body?.sourceName!=='string'||!body.sourceName.trim()||body.sourceName.length>100)throw Error('利用許諾が確認できる供給元情報が必要です。');
 if(!Array.isArray(body.workouts)||body.workouts.length>120)throw Error('調教データの件数が不正です。');
 const mapped=new Map(official.map(x=>[Number(x.horse_no),x])),seen=new Set(),out=[];
 const sourceName=body.sourceName.trim();
 const sourceId=typeof body.sourceRecordId==='string'&&body.sourceRecordId.length<=140?body.sourceRecordId:'';
 for(const [i,x] of body.workouts.entries()){
  const no=Number(x.horseNo),date=x.workoutDate,course=String(x.course||'');
  const row=mapped.get(no);
  if(!row||!DATE.test(date||'')||date>=target.date||date<new Date(Date.parse(target.date+'T00:00:00Z')-42*86400000).toISOString().slice(0,10)||!types.has(course))throw Error('レース前42日以内の正式出走馬・調教種別だけを受け付けます（行 '+(i+1)+'）。');
  if(x.horseName&&x.horseName!==row.horse_name)throw Error('馬番と馬名が一致しません（行 '+(i+1)+'）。');
  const sessionId=String(x.sessionId||'main');
  if(!/^[A-Za-z0-9_-]{1,40}$/.test(sessionId))throw Error('セッションIDが不正です。');
  const k=[target.raceKey,no,date,course,sessionId].join('|');
  if(seen.has(k))throw Error('同じ追い切りが重複しています。');
  seen.add(k);
  const four=seconds(x.fourF,'4F'),last=seconds(x.lastF,'1F');
  if(four===null&&last===null)throw Error('調教計時がありません。');
  if(four!==null&&last!==null&&four<=last)throw Error('4Fと1Fの整合が取れません。');
  out.push({raceKey:target.raceKey,horseNo:no,horseName:row.horse_name,workoutDate:date,course,sessionId,fourF:four,lastF:last,
   sourceName,sourceId,importedAt:new Date().toISOString()});
 }
 return out;
}
const CREATE='CREATE TABLE IF NOT EXISTS lab_workout_evidence (race_key TEXT NOT NULL, horse_no INTEGER NOT NULL, horse_name TEXT NOT NULL, workout_date TEXT NOT NULL, course TEXT NOT NULL, session_id TEXT NOT NULL, four_f REAL, last_f REAL, source_name TEXT NOT NULL, source_record_id TEXT, imported_at TEXT NOT NULL, PRIMARY KEY (race_key,horse_no,workout_date,course,session_id))';
export async function getWorkoutEvidence(db,target,env={}){
 const race=await one(db,'SELECT race_key,race_name,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[target.date,target.venue,target.raceNo]);
 if(!race)return{ok:true,stage:'no-official-card',race:target,runners:[],coverage:{official:0,withWorkout:0},collectionConfigured:Boolean(env.WORKOUT_FEED_URL&&env.WORKOUT_LICENSE_CONFIRMED==='yes'),modelIncorporated:false};
 const official=await query(db,'SELECT horse_no,frame_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no',[race.race_key]);
 const complete=official.length===Number(race.runner_count)&&official.length>0;
 let stored=[],tableReady=true;
 try{stored=await query(db,'SELECT horse_no,horse_name,workout_date,course,session_id,four_f,last_f,source_name,source_record_id,imported_at FROM lab_workout_evidence WHERE race_key=? AND workout_date<? ORDER BY workout_date DESC,horse_no',[race.race_key,target.date]);}
 catch(e){if(missingTable(e))tableReady=false;else throw e;}
 const by=new Map();
 for(const s of stored){const no=Number(s.horse_no),officialHorse=official.find(r=>Number(r.horse_no)===no);if(!officialHorse||s.horse_name!==officialHorse.horse_name)continue;const arr=by.get(no)||[];
 arr.push({date:s.workout_date,course:s.course,fourF:s.four_f,lastF:s.last_f,sourceName:s.source_name,sourceRecordId:s.source_record_id,importedAt:s.imported_at});by.set(no,arr);}
 return{ok:true,stage:!complete?'official-card-incomplete':by.size?'stored':'not-collected',race:{...target,raceName:race.race_name},
  runners:official.map(r=>({horseNo:Number(r.horse_no),frameNo:r.frame_no,horseName:r.horse_name,workouts:by.get(Number(r.horse_no))||[],state:by.has(Number(r.horse_no))?'stored':'unavailable'})),
  coverage:{official:official.length,declared:Number(race.runner_count),withWorkout:by.size,workoutRows:[...by.values()].reduce((n,arr)=>n+arr.length,0)},
  tableReady,collectionConfigured:Boolean(env.WORKOUT_FEED_URL&&env.WORKOUT_LICENSE_CONFIRMED==='yes'),modelIncorporated:false,
  meaning:'取得元が許諾済みの追い切り計時だけを参考表示します。LABO評価点・学習にはまだ反映しません。'};
}
export async function syncWorkoutEvidence(db,env,target,fetcher=fetch){
 if(env.WORKOUT_LICENSE_CONFIRMED!=='yes'||!env.WORKOUT_FEED_URL||!env.WORKOUT_FEED_TOKEN)throw Error('許諾済み調教データ供給元が未設定です。');
 const url=new URL(env.WORKOUT_FEED_URL);
 if(url.protocol!=='https:'||!url.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.username||url.password||url.port)throw Error('供給元URLの設定が不正です。');
 const race=await one(db,'SELECT race_key,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?',[target.date,target.venue,target.raceNo]);
 if(!race)throw Error('正式出馬表が未保存です。');
 const official=await query(db,'SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no',[race.race_key]);
 if(official.length!==Number(race.runner_count)||!official.length)throw Error('正式出馬表の保存数が一致しません。');
 url.searchParams.set('date',target.date);url.searchParams.set('venue',target.venue);url.searchParams.set('race_no',String(target.raceNo));
 const res=await fetcher(url.href,{headers:{authorization:'Bearer '+env.WORKOUT_FEED_TOKEN,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error('調教データ供給元が応答しません（HTTP '+res.status+'）。');
 const input=await res.json();
 const entries=normalizeWorkoutBatch(input,target,official);
 if(!entries.length)return{ok:true,stored:0,stage:'feed-empty',sourceName:input.sourceName,modelIncorporated:false};
 await db.prepare(CREATE).run();
 const statements=entries.map(x=>db.prepare('INSERT INTO lab_workout_evidence (race_key,horse_no,horse_name,workout_date,course,session_id,four_f,last_f,source_name,source_record_id,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key,horse_no,workout_date,course,session_id) DO UPDATE SET four_f=excluded.four_f,last_f=excluded.last_f,source_name=excluded.source_name,source_record_id=excluded.source_record_id,imported_at=excluded.imported_at')
 .bind(x.raceKey,x.horseNo,x.horseName,x.workoutDate,x.course,x.sessionId,x.fourF,x.lastF,x.sourceName,x.sourceId,x.importedAt));
 if(!db.batch)throw Error('データベースの一括保存が使えません。');
 await db.batch(statements);
 return{ok:true,stored:entries.length,stage:'source-collected',sourceName:input.sourceName,modelIncorporated:false};
}
export async function workoutEndpoint(request,env,fetcher=fetch){
 const url=new URL(request.url);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(!env.DB)return reply({ok:false,error:'DB unavailable'},503);
 try{
  if(url.pathname==='/v1/lab/workouts'&&request.method==='GET'){
   const target=workoutTarget(Object.fromEntries(url.searchParams));
   return reply(await getWorkoutEvidence(env.DB,target,env));
  }
  if(url.pathname==='/v1/lab/workouts/sync'&&request.method==='POST'){
   const expected=env.WORKOUT_SYNC_TOKEN;
   if(!expected||request.headers.get('authorization')!=='Bearer '+expected)return reply({ok:false,error:'許可されていない取得操作です。'},403);
   const body=await request.json();if(body.confirm!=='SYNC')return reply({ok:false,error:'confirm=SYNC required'},400);
   const target=workoutTarget(body);return reply(await syncWorkoutEvidence(env.DB,env,target,fetcher));
  }
  return reply({ok:false,error:'method not allowed'},405);
 }catch(e){
  return reply({ok:false,error:String(e.message||e),modelIncorporated:false},/未設定|許諾|未保存|一致しません/.test(String(e.message))?409:400);
 }
}
