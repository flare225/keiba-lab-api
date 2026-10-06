// Public netkeiba five-start table observed 2026-10-06. No forecast odds or target results.
export const HISTORY_SOURCE_URL='https://race.netkeiba.com/race/shutuba_past.html?race_id=202605040311&rf=shutuba_submenu';
export const HISTORY_SNAPSHOT_ID='netkeiba-saudi-history-20261006-v1';
const rows={
 'アイファーマーリン':[['2026-09-12','中山','2歳未勝利',1600,1,12,'1:36.8',34.7,'10-10-9','重'],['2026-08-22','新潟','2歳新馬',1600,2,12,'1:36.3',32.8,'10-10','良']],
 'アゴルディーノ':[['2026-08-15','札幌','コスモス賞',1800,2,8,'1:48.7',35,'3-3-3-3','良'],['2026-06-27','函館','2歳新馬',1200,1,8,'1:09.8',34.8,'5-4','稍']],
 'ギブリ':[['2026-09-26','阪神','2歳新馬',1600,1,15,'1:36.5',34.2,'5-5','良']],
 'グルーヴェンス':[['2026-08-08','新潟','2歳未勝利',1400,1,13,'1:21.7',35.2,'3-3','良'],['2026-07-19','福島','2歳新馬',1200,2,16,'1:10.8',35.1,'4-4','良']],
 'サトノハクマイ':[['2026-09-12','中山','2歳新馬',1600,1,11,'1:38.6',34.9,'2-2-2','重']],
 'ジップスパーク':[['2026-08-22','新潟','2歳新馬',1600,1,12,'1:36.0',33.6,'3-2','良']],
 'デミアン':[['2026-06-13','東京','2歳新馬',1400,1,9,'1:22.8',33.6,'5-4','良']],
 'ニシノトラノスケ':[['2026-08-02','新潟','2歳新馬',1600,1,13,'1:36.7',34.4,'6-3','良']],
 'ハンサム':[['2026-09-26','中山','2歳未勝利',1600,1,12,'1:37.2',35.8,'5-5-3','重'],['2026-09-06','中山','2歳新馬',1600,3,15,'1:37.1',35.3,'3-3-3','稍']],
 'フィリオソラーレ':[['2026-06-06','東京','2歳新馬',1600,1,9,'1:34.3',33.3,'3-3','良']],
 'ベルウッドディープ':[['2026-06-14','東京','2歳新馬',1600,1,8,'1:35.8',33.9,'4-3','良']],
 'ライーリーアース':[['2026-08-22','札幌','クローバー賞',1500,13,14,'1:30.3',36.2,'3-5-6','良'],['2026-07-05','函館','2歳未勝利',1200,1,9,'1:09.8',35.6,'3-2','良'],['2026-06-27','函館','2歳新馬',1200,4,8,'1:10.2',35.2,'5-4','稍']]
};
export const EXPECTED_HISTORY_ROWS=Object.entries(rows).flatMap(([horse_name,starts])=>starts.map(([race_date,venue,race_name,distance,finish_position,field_size,time_text,last3f,corner_positions,track_condition])=>({horse_name,race_date,venue,race_name,surface:'芝',distance,finish_position,field_size,time_text,last3f,corner_positions,track_condition,source_url:HISTORY_SOURCE_URL})));
export async function ingestExpectedHistory(db,source){
 if(source.snapshotId!=='netkeiba-saudi-20261005-v1')throw Error('対象一覧が更新されています。');
 for(const row of EXPECTED_HISTORY_ROWS){if(!source.names.includes(row.horse_name)||row.race_date>=source.date||row.race_date<'2026-01-01')throw Error('過去走スナップショットの検証に失敗しました。')}
 await db.prepare('CREATE TABLE IF NOT EXISTS lab_expected_history_snapshots (snapshot_id TEXT NOT NULL,horse_name TEXT NOT NULL,race_date TEXT NOT NULL,venue TEXT NOT NULL,payload_json TEXT NOT NULL,source_url TEXT NOT NULL,ingested_at TEXT NOT NULL,PRIMARY KEY(snapshot_id,horse_name,race_date,venue))').run();
 const now=new Date().toISOString();
 await db.batch(EXPECTED_HISTORY_ROWS.map(row=>db.prepare('INSERT OR IGNORE INTO lab_expected_history_snapshots(snapshot_id,horse_name,race_date,venue,payload_json,source_url,ingested_at) VALUES(?,?,?,?,?,?,?)').bind(source.snapshotId,row.horse_name,row.race_date,row.venue,JSON.stringify(row),row.source_url,now)));
 return{ok:true,snapshotId:HISTORY_SNAPSHOT_ID,runnerCount:source.names.length,historyRows:EXPECTED_HISTORY_ROWS.length,sourceUrl:HISTORY_SOURCE_URL,officialTablesModified:false,scoreMutation:false,markMutation:false};
}
