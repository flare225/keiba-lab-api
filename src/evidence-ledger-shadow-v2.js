// Offline research only. No DB, fetch, scheduler, production scorer or LOCK imports.
export const LEDGER_MODEL='evidence-ledger-shadow-v2-prototype';
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const round=x=>x==null?null:Math.round(x*100)/100;
const valid=r=>Number.isInteger(r.finish)&&Number.isInteger(r.fieldSize)&&r.fieldSize>=2&&r.finish>=1&&r.finish<=r.fieldSize;
const resultIndex=r=>100*(1-(r.finish-1)/(r.fieldSize-1));
const iso=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const source=s=>{try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
const fields=['finish','fieldSize','distance','surface','venue','time','last3f','cornerPositions'];
function classCode(r){
 const c=r.classEvidence;
 return c?.verified===true&&source(c.sourceUrl)&&c.date===r.date&&c.venue===r.venue&&c.raceName===r.raceName&&['G1','G2','G3','L','OPEN','3WIN','2WIN','1WIN','MAIDEN','NEWCOMER'].includes(c.code)?c.code:null;
}
function positions(rows){
 const samples=rows.flatMap(r=>{
  const s=String(r.cornerPositions||'').trim();if(!/^\d{1,2}(?:[-－→/]\d{1,2}){1,3}$/.test(s))return[];
  const ns=s.match(/\d+/g).map(Number);if(ns.some(n=>n<1||n>r.fieldSize))return[];
  return[{date:r.date,distance:r.distance,firstRecordedFraction:(ns[0]-1)/(r.fieldSize-1),lastRecordedFraction:(ns.at(-1)-1)/(r.fieldSize-1)}];
 });
 const f=mean(samples.map(r=>r.firstRecordedFraction));
 return{samples,style:samples.length<3?null:f<=1/3?'front':f>=2/3?'back':'middle',basis:'historical first recorded corner, same surface, mixed distances; not a target-race forecast'};
}
export function evidenceLedgerShadow(snapshot){
 const race=snapshot?.race;
 if(!iso(race?.date)||!Number.isFinite(race.distance)||race.distance<=0||!race.surface||!Array.isArray(snapshot.runners)||!Array.isArray(snapshot.histories)||!snapshot.runners.length)throw Error('Explicit race context and stored inputs required');
 if(new Set(snapshot.runners.map(r=>r.horseName)).size!==snapshot.runners.length||new Set(snapshot.histories.map(h=>h.horseName)).size!==snapshot.histories.length)throw Error('Duplicate horse identity');
 const horses=snapshot.runners.map(r=>{
  const h=snapshot.histories.find(h=>h.horseName===r.horseName),seen=new Set();
  const rows=(h?.available?h.recent:[]).filter(x=>iso(x.date)&&x.date<race.date&&valid(x)&&x.surface===race.surface).sort((a,b)=>b.date.localeCompare(a.date)).filter(x=>{const k=x.date+'|'+x.venue+'|'+x.raceName;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,3);
  const grouped={};for(const row of rows){const code=classCode(row);if(code)(grouped[code]??=[]).push(resultIndex(row));}
  const classRecords=Object.entries(grouped).map(([code,values])=>({code,starts:values.length,resultIndex:round(mean(values))}));
  const pos=positions(rows),card=snapshot.card?.find(c=>(c.horse_name??c.horseName)===r.horseName);
  const coverage=Object.fromEntries(fields.map(k=>[k,{present:rows.filter(x=>x[k]!=null&&x[k]!=='').length,total:rows.length}]));
  return{horseName:r.horseName,horseNo:r.horseNo??null,frameNo:card?.frame_no??null,
   baseline:{rank:r.rank??null,score:r.score??null,mark:r.mark??null},
   // One descriptive result index, never re-added as an independent form score.
   observedResultIndex:round(mean(rows.map(resultIndex))),
   ability:{score:null,classRecords,unclassifiedStarts:rows.filter(x=>!classCode(x)).length,opponentStrength:null,reason:'Class-stratified evidence only; cross-class/opponent calibration unavailable'},
   condition:{score:null,reason:'No independently verified race-adjusted timing/lap or preparation evidence; raw finishes are not counted twice'},
   distance:{score:null,starts:rows.filter(x=>Number.isFinite(x.distance)).map(x=>({date:x.date,distance:x.distance,extensionMetres:race.distance-x.distance,finish:x.finish,fieldSize:x.fieldSize})),exactStarts:rows.filter(x=>x.distance===race.distance).length,sameVenueStarts:rows.filter(x=>x.venue===race.venue).length,reason:'Adjacent-distance experience and venue experience are separate facts, not proof of target suitability'},
   position:pos,jockey:{score:null,reason:'Verified horse-jockey combination history unavailable; names receive no points'},
   frame:{score:null,reason:'Neighbour styles can be described; no validated draw/pace effect'},
   dataCoverage:{fields:coverage,presentCells:Object.values(coverage).reduce((a,x)=>a+x.present,0),totalCells:rows.length*fields.length,meaning:'Input field presence, not ability or predictive confidence'},
   predictionConfidence:{value:null,reason:'Out-of-date calibration not performed'},
   score:null,rank:null,mark:null,heldReasons:['No validated aggregation of class, condition, distance, pace and jockey evidence'],inputs:rows};
 });
 const distribution={front:0,middle:0,back:0,unknown:0};for(const h of horses)distribution[h.position.style||'unknown']++;
 const scenarios=['slow','average','high'].map(pace=>({pace,probability:null,scoreAdjustments:null,reason:'Conditional scenario only; race laps and target position/settling evidence missing'}));
 for(const h of horses)h.frame.neighbours=horses.filter(x=>h.horseNo!=null&&x.horseNo!=null&&Math.abs(x.horseNo-h.horseNo)===1).map(x=>({horseNo:x.horseNo,style:x.position.style}));
 return{modelVersion:LEDGER_MODEL,phase:'offline-research',race,baselineSha:snapshot.baselineSha??null,horses,distribution,scenarios,
  guardrails:{productionEnabled:false,automaticPromotion:false,formalLock:false,inputModified:false,externalRequests:0,dbQueries:0,accuracyValidated:false,missingIsNotZeroAbility:true,overallRankingHeld:true}};
}
