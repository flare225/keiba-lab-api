const base='https://keiba-lab-api.sekai-no-bancyou.workers.dev';
for(const t of [{date:'2026-10-25',venue:'京都',raceNo:11,count:21},{date:'2026-10-24',venue:'東京',raceNo:11,count:14}]){
 const q=new URLSearchParams({date:t.date,venue:t.venue,race_no:String(t.raceNo)});
 const r=await fetch(base+'/v1/lab/expected-runners?'+q,{signal:AbortSignal.timeout(20000)}),d=await r.json();
 if(!r.ok||!d.ok||d.runners?.length!==t.count||!d.source?.snapshotId?.startsWith('registered:')||d.runners.some(x=>!x.horseName||!Number.isInteger(x.age)||x.horseNo!==null||x.frameNo!==null)||r.headers.get('access-control-allow-origin')!=='*')throw Error(JSON.stringify({target:t,status:r.status,data:d}));
 console.log('EXPECTED_ROSTER_DISPLAY',JSON.stringify({target:t,status:r.status,snapshotId:d.source.snapshotId,count:d.runners.length,names:d.runners.map(x=>x.horseName),numbering:'unconfirmed',externalRequests:0,newRows:0}));
}
