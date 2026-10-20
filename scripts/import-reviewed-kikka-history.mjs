const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev',target={date:'2026-10-25',venue:'京都',raceNo:11};
async function call(method){const q=new URLSearchParams({date:target.date,venue:target.venue,race_no:'11'}),r=await fetch(base+'/v1/lab/reviewed-upcoming-history'+(method==='GET'?'?'+q:''),{method,headers:{'content-type':'application/json','cache-control':'no-cache'},...(method==='POST'?{body:JSON.stringify({...target,confirm:'IMPORT_BUNDLED'})}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||!data.ok)throw Error(JSON.stringify({httpStatus:r.status,data}));return data;}
const before=await call('GET');console.log('BEFORE',JSON.stringify(before));
const saved=before.available?{...before,savedRows:0}:await call('POST');console.log('IMPORT',JSON.stringify(saved));
const after=await call('GET');if(!after.integrityVerified||after.sha256!==saved.sha256||after.storedRows!==63||after.horses.length!==21||after.horses.some(h=>h.storedRows!==3||h.last3fRows!==3))throw Error('Independent readback mismatch');
console.log('VERIFIED',JSON.stringify({newRows:saved.savedRows,verifiedHorses:after.horses.length,...after}));
