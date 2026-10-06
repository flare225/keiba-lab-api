export function compareReplayMarks(top5=[],results=[]){
 const finished=(results||[]).filter(x=>Number.isInteger(Number(x.finish_position))&&Number(x.finish_position)>0);
 const byNo=new Map(finished.map(x=>[Number(x.horse_no),x]));
 const last3f=r=>r?.last3f==null||!Number.isFinite(Number(r.last3f))?null:Number(r.last3f);
 const recorded=finished.filter(x=>last3f(x)!=null).length;
 const marks=(top5||[]).map(x=>{const r=byNo.get(Number(x.horseNo));return{mark:x.mark||null,horseNo:Number(x.horseNo),horseName:x.horseName||null,predictedRank:Number(x.rank||0)||null,finishPosition:r?Number(r.finish_position):null,finishStatus:r?.finish_status||null,last3f:last3f(r)}});
 const actualTop3=finished.filter(x=>Number(x.finish_position)<=3).sort((a,b)=>Number(a.finish_position)-Number(b.finish_position)).map(x=>({finishPosition:Number(x.finish_position),horseNo:Number(x.horse_no),horseName:x.horse_name,last3f:last3f(x)}));
 const marked=new Set(marks.map(x=>x.horseNo)),honmei=marks.find(x=>x.mark==='◎')||marks[0]||null,covered=actualTop3.filter(x=>marked.has(x.horseNo));
 return{available:finished.length>0,actualTop3,marks,last3fCoverage:{finishers:finished.length,recorded,missing:finished.length-recorded},metrics:{honmeiFinish:honmei?.finishPosition??null,winnerMarked:actualTop3[0]?marked.has(actualTop3[0].horseNo):false,top3MarkedCount:covered.length,top3CoveragePct:actualTop3.length?Math.round(covered.length/actualTop3.length*1000)/10:null},guardrails:{comparisonRunsAfterMarksFrozen:true,resultNeverFeedsReplayScore:true,replayEvidenceGradeUnchanged:true}};
}
