import {resultSourceMeta} from './official-result-sources-v3.39.0.js';
import {parseOfficialResultDetails} from './result-detail-v3.39.0.js';
import {extractProfileLinks} from './collection-profile-parser-v3.32.0.js';

export async function storedHistoryResultSource(db,race,today){
 if(race.race_date>=today)return null;
 const urls=new Set();
 for(const table of ['lab_race_result_details','lab_race_outcomes']){
  let rows;try{rows=(await db.prepare(`SELECT DISTINCT source_url FROM ${table} WHERE race_key=? AND source_url IS NOT NULL`).bind(race.race_key).all()).results||[];}
  catch(e){if(/no such table/.test(String(e)))continue;throw e;}
  for(const row of rows){const meta=resultSourceMeta(row.source_url);if(meta&&meta.date===race.race_date&&meta.venue===race.venue&&meta.raceNo===Number(race.race_no))urls.add(meta.url);}
 }
 return urls.size===1?[...urls][0]:null;
}

export function resultProfileLinks(html,runners,url){
 const result=parseOfficialResultDetails(html,runners);
 if(!result.ok||result.rows.length!==runners.length||result.rows.some(r=>r.age!==Number(runners.find(x=>x.horse_name===r.horseName)?.age)))throw Error('結果ページの全馬・馬番・年齢を保存済み出馬表と照合できません。');
 // Only identity links are reused; target-race results never become prior features.
 return extractProfileLinks(html,runners.map(r=>r.horse_name),url);
}
