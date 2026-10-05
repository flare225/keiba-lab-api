import {sha256} from './card-evidence.js';
export async function verifyStoredSeal(existing){
 if(!existing?.snapshot_json||!existing.snapshot_sha256||await sha256(existing.snapshot_json)!==existing.snapshot_sha256)throw new Error('Prospective seal missing or snapshot hash mismatch');
 return JSON.parse(existing.snapshot_json);
}
export async function writeAtomicSeal(db,{raceKey,date,modelVersion,track,sealKind,weights,snapshotJson,hash,runnerCount,futureDayLock,quality,sealedAt}){
 const statements=[
  db.prepare(`INSERT INTO lab_model_locks (race_key,model_version,track_condition,seal_kind,weights_json,snapshot_json,sealed_at) VALUES (?,?,?,?,?,?,?)`).bind(raceKey,modelVersion,track,sealKind,JSON.stringify(weights),snapshotJson,sealedAt),
  db.prepare(`INSERT INTO lab_prospective_seals (race_key,race_date,model_version,track_condition,seal_kind,snapshot_sha256,runner_count,outcome_count_at_seal,future_day_lock,quality_json,sealed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(raceKey,date,modelVersion,track,sealKind,hash,runnerCount,0,futureDayLock?1:0,JSON.stringify(quality),sealedAt)
 ];
 await db.batch(statements);
}
export async function ensureSealGuards(db){
 for(const table of ['lab_model_locks','lab_prospective_seals']){
  for(const action of ['UPDATE','DELETE'])await db.prepare(`CREATE TRIGGER IF NOT EXISTS ${table}_prospective_no_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN OLD.model_version='3.3.0-prospective' BEGIN SELECT RAISE(ABORT,'prospective seals are immutable'); END`).run();
 }
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS prospective_no_outcomes BEFORE INSERT ON lab_model_locks WHEN NEW.model_version='3.3.0-prospective' AND EXISTS (SELECT 1 FROM lab_race_outcomes WHERE race_key=NEW.race_key AND finish_position IS NOT NULL) BEGIN SELECT RAISE(ABORT,'official outcomes already exist'); END`).run();
}
export async function ensureCardSealGuard(db){
 await db.prepare(`CREATE TRIGGER IF NOT EXISTS prospective_requires_current_card BEFORE INSERT ON lab_model_locks
 WHEN NEW.model_version='3.3.0-prospective' AND (
 NOT EXISTS (SELECT 1 FROM lab_card_source_evidence e JOIN jra_races r ON r.race_key=e.race_key
 WHERE e.race_key=NEW.race_key AND e.card_fetched_at=r.fetched_at
 AND e.source_sha256=json_extract(NEW.snapshot_json,'$.cardEvidence.source_sha256')
 AND e.runner_sha256=json_extract(NEW.snapshot_json,'$.cardEvidence.runner_sha256')
 AND e.declared_count=json_extract(NEW.snapshot_json,'$.race.runnerCount')
 AND e.source_row_count=e.declared_count AND e.parsed_count=e.declared_count
 AND e.horse_numbers_observed=1 AND e.frames_observed=1)
 OR (SELECT COUNT(*) FROM jra_runners WHERE race_key=NEW.race_key)<>json_extract(NEW.snapshot_json,'$.race.runnerCount')
 OR EXISTS (SELECT 1 FROM jra_runners rr WHERE rr.race_key=NEW.race_key AND NOT EXISTS (
 SELECT 1 FROM json_each(NEW.snapshot_json,'$.runners') p WHERE json_extract(p.value,'$.horseNo')=rr.horse_no
 AND json_extract(p.value,'$.horseName')=rr.horse_name AND json_extract(p.value,'$.frameNo')=rr.frame_no))
 ) BEGIN SELECT RAISE(ABORT,'source card changed or is unverified'); END`).run();
}
