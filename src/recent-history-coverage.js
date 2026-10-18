// Live collection target only. Frozen learning eligibility remains unchanged.
// Bound the inner scan to three valid prior starts; fewer career starts are
// handled by the collector's existing receipt/cooldown, never fabricated.
export function missingRecentHistorySql(key,date){
 return `(SELECT COUNT(*) FROM jra_runners target WHERE target.race_key=${key} AND (SELECT COUNT(*) FROM (SELECT 1 FROM jra_past_performances p WHERE p.horse_name=target.horse_name AND p.race_date<${date} AND p.race_date>=printf('%d-01-01',CAST(substr(${date},1,4) AS INTEGER)-target.age+2) AND p.finish_position>=1 AND p.field_size>=p.finish_position LIMIT 3))<3)`;
}
