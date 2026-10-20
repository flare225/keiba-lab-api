const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
for(const target of [{date:'2026-10-25',venue:'京都',raceNo:11,rows:63},{date:'2026-10-24',venue:'東京',raceNo:11,rows:22}]){
 const query=new URLSearchParams({date:target.date,venue:target.venue,race_no:'11'});
 async function read(path){const r=await fetch(base+path+'?'+query,{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(20000)}),d=await r.json();if(!r.ok||!d.ok)throw Error(JSON.stringify({path,status:r.status,data:d}));return d;}
 const history=await read('/v1/lab/reviewed-upcoming-history');if(!history.integrityVerified||history.storedRows!==target.rows)throw Error('Previously saved history is unavailable');console.log('REUSED_HISTORY',JSON.stringify({target,rows:history.storedRows,sha256:history.sha256,newRows:0}));
 const before=await read('/v1/lab/automatic-learning-candidate'),prediction=await read('/v1/lab/automatic-prediction');
 const response=await fetch(base+'/v1/lab/automatic-learning-candidate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...target,confirm:'LABEL'}),signal:AbortSignal.timeout(20000)}),label=await response.json();if(!response.ok||!label.ok)throw Error(JSON.stringify(label));
 const after=await read('/v1/lab/automatic-learning-candidate');if(!prediction.available&&(label.status!=='awaiting-pre-race-prediction'||label.saved!==0||after.available))throw Error('Unsealed race must not produce a label');
 console.log('VERIFIED_CANDIDATE_STATE',JSON.stringify({target,predictionAvailable:prediction.available,before,label,after}));
}
// Continue the bounded data task while preserving the live shared gate.
await import('./deliver-upcoming-history.mjs');
