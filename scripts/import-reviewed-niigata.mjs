const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev',target={date:'2026-10-25',venue:'新潟',raceNo:11};
const query=new URLSearchParams({date:target.date,venue:target.venue,race_no:'11'});
async function call(path,body,allowMissing=false){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)}),d=await r.json();if(allowMissing&&r.status===404)return null;if(!r.ok||!d.ok)throw Error(JSON.stringify({path,status:r.status,data:d}));return d;}
const before=await call('/v1/lab/expected-runners?'+query,null,true);
const saved=before?{storedRunners:22,idempotent:true}:await call('/v1/lab/expected-roster-seed-import',{snapshotId:'netkeiba-lumiere-registration-reviewed-20261020-v1',confirm:'IMPORT_BUNDLED'});
const roster=await call('/v1/lab/expected-runners?'+query);if(roster.runners.length!==22||!roster.source.snapshotId.startsWith('registered:')||saved.snapshotId&&roster.source.snapshotId!=='registered:'+saved.snapshotId)throw Error('Roster readback failed');
console.log('NIIGATA_ROSTER_SAVED',JSON.stringify({target,newRaces:before?0:1,registeredHorses:22,snapshotId:roster.source.snapshotId,readbackMatches:true}));
const old=await call('/v1/lab/reviewed-upcoming-history?'+query);
const imported=old.available?{...old,savedRows:0}:await call('/v1/lab/reviewed-upcoming-history',{...target,confirm:'IMPORT_BUNDLED'});
const history=await call('/v1/lab/reviewed-upcoming-history?'+query);
if(!history.integrityVerified||history.sha256!==imported.sha256||history.storedRows!==65||history.horses.length!==22||history.horses.some(h=>h.last3fRows!==h.storedRows))throw Error('History readback failed');
console.log('NIIGATA_HISTORY_SAVED',JSON.stringify({target,newRows:imported.savedRows,verifiedRows:history.storedRows,verifiedHorses:history.horses.length,newHistoryHorses:old.available?0:22,sha256:history.sha256,officialTablesModified:history.officialTablesModified,externalRequests:0}));

for(const [raceNo,count] of [[9,23],[10,14]]){
 const q=new URLSearchParams({date:target.date,venue:target.venue,race_no:String(raceNo)}),old=await call('/v1/lab/expected-runners?'+q,null,true);
 const imported=old?null:await call('/v1/lab/expected-roster-seed-import',{snapshotId:'netkeiba-niigata-'+raceNo+'-registration-reviewed-20261020-v1',confirm:'IMPORT_BUNDLED'});
 const read=await call('/v1/lab/expected-runners?'+q);if(read.runners.length!==count||!read.source.snapshotId.startsWith('registered:')||imported&&read.source.snapshotId!=='registered:'+imported.snapshotId)throw Error('Additional roster readback failed');
 console.log('NIIGATA_ROSTER_SAVED',JSON.stringify({target:{...target,raceNo},newRaces:old?0:1,registeredHorses:count,snapshotId:read.source.snapshotId,readbackMatches:true,historySupplemented:false}));
 const prior=await call('/v1/lab/reviewed-upcoming-history?'+q),saved=prior.available?{...prior,savedRows:0}:await call('/v1/lab/reviewed-upcoming-history',{...target,raceNo,confirm:'IMPORT_BUNDLED'});
 const history=await call('/v1/lab/reviewed-upcoming-history?'+q);if(!history.integrityVerified||history.sha256!==saved.sha256||history.storedRows!==count*3||history.rows.length!==count*3||history.horses.length!==count||history.horses.some(h=>h.storedRows!==3||h.last3fRows!==3))throw Error('Additional history readback failed');
 console.log('NIIGATA_HISTORY_SAVED',JSON.stringify({target:{...target,raceNo},newRows:saved.savedRows,verifiedRows:history.storedRows,verifiedHorses:count,newHistoryHorses:prior.available?0:count,sha256:history.sha256,externalRequests:0}));

}
