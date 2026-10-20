import {ADDITIONAL_WEEK_HISTORY_CONFIGS} from './additional-week-reviewed-history.js';
import {NIIGATA_HISTORY_CONFIGS} from './niigata-additional-history.js';
import {LUMIERE_HISTORY_ROWS,LUMIERE_HISTORY_URL,LUMIERE_OBSERVED_AT,LUMIERE_AGES} from './lumiere-reviewed-history.js';
import {ARTEMIS_HISTORY_ROWS,ARTEMIS_HISTORY_URL,ARTEMIS_OBSERVED_AT} from './artemis-reviewed-history.js';
import {KIKKA_HISTORY_ROWS,KIKKA_HISTORY_URL,KIKKA_OBSERVED_AT} from './kikka-reviewed-history.js';
import {sha256} from './card-evidence.js';
function reviewed(source){
 const config=ADDITIONAL_WEEK_HISTORY_CONFIGS[`${source.date}:${source.venue}:${source.raceNo}`]|| (source.date==='2026-10-25'&&source.venue==='新潟'&&NIIGATA_HISTORY_CONFIGS[source.raceNo]?NIIGATA_HISTORY_CONFIGS[source.raceNo]:source.date==='2026-10-25'&&source.venue==='新潟'&&source.raceNo===11?{rows:LUMIERE_HISTORY_ROWS,url:LUMIERE_HISTORY_URL,observed:LUMIERE_OBSERVED_AT,ages:LUMIERE_AGES,count:22,from:'2025-01-01'}:source.date==='2026-10-25'&&source.venue==='京都'&&source.raceNo===11?{rows:KIKKA_HISTORY_ROWS,url:KIKKA_HISTORY_URL,observed:KIKKA_OBSERVED_AT,age:3,count:21,from:'2025-01-01'}:source.date==='2026-10-24'&&source.venue==='東京'&&source.raceNo===11?{rows:ARTEMIS_HISTORY_ROWS,url:ARTEMIS_HISTORY_URL,observed:ARTEMIS_OBSERVED_AT,age:2,count:14,from:'2026-01-01'}:null);
 if(!config||!source.snapshotId.startsWith('registered:')||source.names.length!==config.count||new Set(config.rows.map(r=>r.horse_name)).size!==config.count||config.rows.some(r=>!source.names.includes(r.horse_name)||source.ages[r.horse_name]!== (config.ages?.[r.horse_name]??config.age)||r.race_date>=source.date||r.race_date<config.from||r.finish_position<1||r.finish_position>r.field_size||r.last3f<=0))throw Error('確認済み登録名簿に一致しません。');
 return config;
}
export async function readReviewedUpcomingHistory(db,source){
 const config=reviewed(source),expected=config.rows;let stored;
 try{stored=(await db.prepare('SELECT horse_name,race_date,venue,payload_json,source_url FROM lab_expected_history_snapshots WHERE snapshot_id=? ORDER BY horse_name,race_date,venue').bind(source.snapshotId).all()).results||[]}catch(e){if(/no such table/.test(String(e)))return{ok:true,available:false,storedRows:0};throw e}
 if(!stored.length)return{ok:true,available:false,storedRows:0};
 if(stored.length!==expected.length||stored.some(r=>r.source_url!==config.url||r.payload_json!==JSON.stringify(expected.find(x=>x.horse_name===r.horse_name&&x.race_date===r.race_date&&x.venue===r.venue))))throw Error('二次ソース過去走のDB読み返しが一致しません。');
 return{ok:true,available:true,integrityVerified:true,snapshotId:source.snapshotId,sha256:await sha256(JSON.stringify(stored)),sourceUrl:config.url,observedAt:config.observed,storedRows:stored.length,omittedStarts:config.omittedStarts||[],rows:stored.map(r=>JSON.parse(r.payload_json)),horses:source.names.map(horseName=>({horseName,storedRows:stored.filter(r=>r.horse_name===horseName).length,last3fRows:stored.filter(r=>r.horse_name===horseName&&JSON.parse(r.payload_json).last3f>0).length})),officialTablesModified:false,preRacePredictionSaved:false,learningCandidateRegistered:false,externalRequests:0};
}
export async function importReviewedUpcomingHistory(db,source){
 const rows=reviewed(source).rows;await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_history_snapshots (snapshot_id TEXT NOT NULL,horse_name TEXT NOT NULL,race_date TEXT NOT NULL,venue TEXT NOT NULL,payload_json TEXT NOT NULL,source_url TEXT NOT NULL,ingested_at TEXT NOT NULL,PRIMARY KEY(snapshot_id,horse_name,race_date,venue))').run();
 try{
 const results=await db.batch(rows.map(r=>db.prepare('INSERT OR IGNORE INTO lab_expected_history_snapshots VALUES(?,?,?,?,?,?,?)').bind(source.snapshotId,r.horse_name,r.race_date,r.venue,JSON.stringify(r),r.source_url,new Date().toISOString())));
 const read=await readReviewedUpcomingHistory(db,source);if(!read.integrityVerified)throw Error('補完保存を確認できません。');
 return{...read,savedRows:results.reduce((n,r)=>n+(Number(r.meta?.changes)||0),0)};
 }catch(e){e.saveMayHaveSucceeded=true;throw e;}
}
