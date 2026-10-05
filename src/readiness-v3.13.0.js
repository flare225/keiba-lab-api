export function deriveRaceReadiness({declared=0,stored=0,prediction=false,userRevision=false,decisionLab=false,resultRows=0}={}){
 const cardComplete=Number(declared)>0&&Number(stored)===Number(declared);
 const resultComplete=cardComplete&&Number(resultRows)===Number(declared);
 const stages=[
  {id:'official-card',label:'公式出馬表',ready:cardComplete},
  {id:'labo-lock',label:'LABO事前LOCK',ready:prediction},
  {id:'user-mark',label:'USER印',ready:userRevision},
  {id:'decision-lab',label:'再精査',ready:decisionLab},
  {id:'official-result',label:'公式結果',ready:resultComplete},
 ];
 let next='official-card';
 if(cardComplete)next='labo-lock';
 if(prediction)next='user-mark';
 if(userRevision)next='decision-lab';
 if(decisionLab)next='official-result';
 if(resultComplete)next='review';
 return{cardComplete,resultComplete,stages,next,preRaceReady:cardComplete&&prediction&&userRevision&&decisionLab,reviewReady:resultComplete&&prediction,guardrails:{resultNotRequiredForPreRaceReady:true,predictionRequiredBeforeDecisionLab:true,noSyntheticCompletion:true}};
}
