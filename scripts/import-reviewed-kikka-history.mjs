const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
const targets=[{date:'2026-10-25',venue:'京都',raceNo:11,rows:63,horses:21},{date:'2026-10-24',venue:'東京',raceNo:11,rows:22,horses:14}];
async function call(method,target){const q=new URLSearchParams({date:target.date,venue:target.venue,race_no:'11'}),r=await fetch(base+'/v1/lab/reviewed-upcoming-history'+(method==='GET'?'?'+q:''),{method,headers:{'content-type':'application/json','cache-control':'no-cache'},...(method==='POST'?{body:JSON.stringify({...target,confirm:'IMPORT_BUNDLED'})}:{}),signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||!data.ok)throw Error(JSON.stringify({httpStatus:r.status,data}));return data;}
for(const target of targets){
const before=await call('GET',target);console.log('BEFORE',JSON.stringify(before));
const saved=before.available?{...before,savedRows:0}:await call('POST',target);console.log('IMPORT',JSON.stringify(saved));
const after=await call('GET',target);if(!after.integrityVerified||after.sha256!==saved.sha256||after.storedRows!==target.rows||after.horses.length!==target.horses||after.horses.some(h=>h.storedRows<1||h.last3fRows!==h.storedRows))throw Error('Independent readback mismatch');
console.log('VERIFIED',JSON.stringify({newRows:saved.savedRows,verifiedHorses:after.horses.length,...after}));

}
