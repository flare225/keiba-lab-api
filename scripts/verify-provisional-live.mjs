import {mkdir,writeFile} from 'node:fs/promises';
const targets=[['2026-10-24','東京',11],['2026-10-25','京都',11],['2026-10-25','新潟',11]],report={newDbSaves:0,officialLocks:0,targets:[]};
await mkdir('provisional-evidence',{recursive:true});
for(const [date,venue,raceNo] of targets){
 const query=new URLSearchParams({date,venue,race_no:String(raceNo)}),url='https://keiba-lab-api.sekai-no-bancyou.workers.dev/v1/lab/provisional-prediction?'+query;
 try{const response=await fetch(url),body=await response.json();const item={date,venue,raceNo,http:response.status,ok:body.ok,error:body.error,runnerCount:body.runnerCount,scoredRunners:body.scoredRunners,version:body.version,model:body.modelVersion,top:body.runners?.filter(r=>r.rank<=5&&r.rank!==null).map(({horseName,rank,score,mark})=>({horseName,rank,score,mark}))};report.targets.push(item);await writeFile('provisional-evidence/'+venue+'.json',JSON.stringify(body,null,2));if(/D1|quota|daily limit|rows read/i.test(body.error||'')){report.stopped='possible-D1-limit';break;}}
 catch(e){report.targets.push({date,venue,raceNo,error:String(e)});break;}
}
await writeFile('provisional-evidence/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
