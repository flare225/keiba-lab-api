export function compareReplay(top5=[],results=[]){
 const finished=(results||[]).filter(x=>Number.isInteger(Number(x.finish_position))&&Number(x.finish_position)>0);
 const byNo=new Map(finished.map(x=>[Number(x.horse_no),x]));
 const marks=(top5||[]).map(x=>{const r=byNo.get(Number(x.horseNo));return{mark:x.mark||null,horseNo:Number(x.horseNo),horseName:x.horseName||null,predictedRank:Number(x.rank||0)||null,finishPosition:r?Number(r.finish_position):null,finishStatus:r?.finish_status||null}});
 const actualTop3=finished.filter(x=>Number(x.finish_position)<=3).sort((a,b)=>Number(a.finish_position)-Number(b.finish_position)).map(x=>({finishPosition:Number(x.finish_position),horseNo:Number(x.horse_no),horseName:x.horse_name}));
 const markedNos=new Set(marks.map(x=>x.horseNo));
 const top3Marked=actualTop3.filter(x=>markedNos.has(x.horseNo));
 const honmei=marks.find(x=>x.mark==='◎')||marks[0]||null;
 return{available:finished.length>0,actualTop3,marks,metrics:{honmeiFinish:honmei?.finishPosition??null,winnerMarked:actualTop3[0]?markedNos.has(actualTop3[0].horseNo):false,top3MarkedCount:top3Marked.length,top3CoveragePct:actualTop3.length?Math.round(top3Marked.length/actualTop3.length*1000)/10:null},guardrails:{comparisonRunsAfterPrediction:true,resultNeverFeedsReplayScore:true,notProspectiveAccuracyCredit:true}};
}
