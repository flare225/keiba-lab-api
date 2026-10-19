import {sha256} from './card-evidence.js';
import {jstDay} from './history-collection-v3.37.0.js';
export function validateExpectedRoster(input,stamp=Date.now()){
 const date=String(input.date||''),venue=input.venue,raceNo=Number(input.raceNo),observed=Date.parse(input.observedAt);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'].includes(venue)||!Number.isInteger(raceNo)||raceNo<1||raceNo>12||!Number.isFinite(observed)||observed>stamp||jstDay(observed)>date||date<jstDay(stamp))throw Error('開催前の名簿対象・確認日時を検証できません。');
 const url=new URL(input.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error('名簿の出典URLが不正です。');
 const provider=input.provider;
 if(!(provider==='JRA'&&url.hostname==='www.jra.go.jp'||provider==='netkeiba'&&['race.netkeiba.com','news.netkeiba.com','own.netkeiba.com'].includes(url.hostname)))throw Error('対応する名簿出典を指定してください。');
 if(!['special-registration','expected-runners'].includes(input.kind)||typeof input.sourceText!=='string'||input.sourceText.length<20||input.sourceText.length>200000)throw Error('名簿の根拠本文が必要です。');
 let officialHorsePage;
 if(input.officialHorsePage!=null){const p=new URL(input.officialHorsePage);if(p.protocol!=='https:'||p.hostname!=='www.jra.go.jp'||p.username||p.password||p.port||p.search||p.hash||!/^\/keiba\/(?:g1|race)\/[a-z0-9_-]+\/horse\.html$/.test(p.pathname))throw Error('公式プロフィール発見先が不正です。');officialHorsePage=p.href;}
 const runners=input.runners;
 if(!Array.isArray(runners)||!runners.length||runners.length>100||new Set(runners.map(r=>r.horseName)).size!==runners.length||runners.some(r=>typeof r.horseName!=='string'||!r.horseName.trim()||r.horseName!==r.horseName.trim()||r.horseName.length>40||!input.sourceText.includes(r.horseName)||!Number.isInteger(r.age)||r.age<2||r.age>15||r.horseNo!=null||r.frameNo!=null))throw Error('登録馬名・年齢・根拠本文を検証できません。枠番・馬番は保存しません。');
 return{date,venue,raceNo,raceName:String(input.raceName||'登録・想定名簿').slice(0,100),provider,kind:input.kind,sourceUrl:url.href,...(officialHorsePage?{officialHorsePage}:{}),observedAt:new Date(observed).toISOString(),sourceText:input.sourceText,runners:runners.map(r=>({horseName:r.horseName,age:r.age}))};
}
export async function saveExpectedRoster(db,input,stamp=Date.now()){
 const record=validateExpectedRoster(input,stamp),body=JSON.stringify(record),hash=await sha256(body),key=`${record.date}:${record.venue}:${record.raceNo}`;
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_roster_registry(snapshot_id TEXT PRIMARY KEY,race_key TEXT NOT NULL,record_json TEXT NOT NULL,source_sha256 TEXT NOT NULL,stored_at TEXT NOT NULL)').run();
 for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS expected_roster_no_${action.toLowerCase()} BEFORE ${action} ON lab_expected_roster_registry BEGIN SELECT RAISE(ABORT,'expected roster snapshot is immutable'); END`).run();
 try{
 const result=await db.prepare('INSERT OR IGNORE INTO lab_expected_roster_registry VALUES(?,?,?,?,?)').bind(hash,key,body,await sha256(record.sourceText),new Date(stamp).toISOString()).run();
 const read=await db.prepare('SELECT record_json FROM lab_expected_roster_registry WHERE snapshot_id=?').bind(hash).first();if(!read||read.record_json!==body||await sha256(read.record_json)!==hash)throw Error('登録・想定名簿のDB読み返しに失敗しました。');
 return{ok:true,snapshotId:hash,storedRunners:record.runners.length,idempotent:Number(result.meta?.changes)!==1,formalCardSaved:false,officialIdentityVerified:false,externalRequests:0};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
export async function storedExpectedSources(db,from,to){
 let rows;try{rows=(await db.prepare('SELECT snapshot_id,record_json FROM lab_expected_roster_registry WHERE substr(race_key,1,10) BETWEEN ? AND ? ORDER BY stored_at DESC,rowid DESC LIMIT 120').bind(from,to).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return [];throw e;}
 const result=[],seen=new Set();for(const row of rows){if(await sha256(row.record_json)!==row.snapshot_id)throw Error('登録・想定名簿のハッシュが一致しません。');const s=JSON.parse(row.record_json),key=`${s.date}:${s.venue}:${s.raceNo}`;if(seen.has(key))continue;seen.add(key);result.push({...s,sourceText:undefined,runners:undefined,snapshotId:'registered:'+row.snapshot_id,raceKey:key,names:s.runners.map(r=>r.horseName),ages:Object.fromEntries(s.runners.map(r=>[r.horseName,r.age])),priority:50,rosterBasis:'expected-snapshot'});}return result;
}
