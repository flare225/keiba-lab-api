export const LIVE_KINDS=['odds','body_weight','track_bias'];
export function deriveLiveCoverage(rows=[],now=Date.now()){
 const maxAge={odds:20*60e3,body_weight:4*60*60e3,track_bias:90*60e3},latest={};
 for(const r of rows){if(!LIVE_KINDS.includes(r.kind))continue;if(!latest[r.kind]||String(r.observed_at)>String(latest[r.kind].observed_at))latest[r.kind]=r}
 const out={};
 for(const k of LIVE_KINDS){const r=latest[k],t=r?Date.parse(r.observed_at):NaN,age=Number.isFinite(t)?Math.max(0,now-t):null;out[k]={available:!!r,fresh:!!r&&age<=maxAge[k],observedAt:r?.observed_at||null,source:r?.source||null,ageMinutes:age==null?null:Math.round(age/60000)}}
 return out;
}
