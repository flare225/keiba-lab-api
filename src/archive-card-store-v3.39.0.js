// Whole-field insertion uses one JSON statement, leaving room for shared budget and evidence queries.
export async function persistArchiveCard(db,probe){
 if(typeof db.batch!=='function'||probe.races?.length!==1)throw Error('出馬表1レースの一括保存が必要です。');const race=probe.races[0],runners=race.runners;
 if(!race.venue||!Number.isInteger(race.raceNo)||race.raceNo<1||race.raceNo>12||!runners?.length||runners.length>18||runners.length!==race.runnerCount||runners.some((x,i)=>x.horseNo!==i+1||!x.name)||new Set(runners.map(x=>x.name)).size!==runners.length)throw Error('全馬の出馬表を確認できません。');
 const raceKey=probe.date+':'+race.venue+':'+race.raceNo,fetchedAt=new Date().toISOString();
 await db.batch([
 db.prepare('INSERT INTO jra_races(race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET race_name=excluded.race_name,surface=excluded.surface,distance=excluded.distance,source_url=excluded.source_url,runner_count=excluded.runner_count,fetched_at=excluded.fetched_at').bind(raceKey,probe.date,race.venue,race.raceNo,race.raceName,race.surface,race.distance,race.sourceUrl,race.runnerCount,fetchedAt),
 db.prepare('DELETE FROM jra_runners WHERE race_key=?').bind(raceKey),
 db.prepare("INSERT INTO jra_runners(race_key,horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer,fetched_at) SELECT ?,json_extract(value,'$.horseNo'),json_extract(value,'$.frameNo'),json_extract(value,'$.name'),json_extract(value,'$.sex'),json_extract(value,'$.age'),json_extract(value,'$.assignedWeight'),json_extract(value,'$.jockey'),json_extract(value,'$.trainer'),? FROM json_each(?)").bind(raceKey,fetchedAt,JSON.stringify(runners))]);
 return{ok:true,fetchedAt,saved:[{raceKey,status:'saved',runnerCount:runners.length}]};
}
