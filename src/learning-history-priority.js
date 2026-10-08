// Scheduling estimate only: captureExperimentRace still validates every feature
// and every result. Never use target-day or later rows to promote a race.
export function missingPriorHistorySql(key,date){
 return `(SELECT COUNT(*) FROM jra_runners target WHERE target.race_key=${key} AND NOT EXISTS(SELECT 1 FROM jra_past_performances p WHERE p.horse_name=target.horse_name AND p.race_date<${date} AND p.race_date>=printf('%d-01-01',CAST(substr(${date},1,4) AS INTEGER)-target.age+2) AND p.finish_position>=1 AND p.field_size>=p.finish_position))`;
}
