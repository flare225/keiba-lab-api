export function deriveRaceOps({readiness={},prelock={},alerts={},prediction={},decisionLab={}}={}){
 const cardComplete=readiness?.readiness?.cardComplete===true;
 const prelockAllowed=prelock?.gate==='ALLOW_PRELOCK';
 const predictionReady=prediction?.available===true||readiness?.prediction?.available===true;
 const userMarkReady=readiness?.userMark?.available===true||readiness?.readiness?.stages?.some?.(x=>x.id==='user-mark'&&x.ready)===true;
 const decisionReady=decisionLab?.available===true||readiness?.decisionLab?.available===true;
 const alertStatus=alerts?.status||'UNKNOWN';
 let nextAction='WAIT_OFFICIAL_CARD';
 if(cardComplete)nextAction=prelockAllowed?'CREATE_PRELOCK':'FIX_CARD_AUDIT';
 if(prelockAllowed&&predictionReady)nextAction='ENTER_USER_MARKS';
 if(prelockAllowed&&predictionReady&&userMarkReady)nextAction='RUN_DECISION_LAB';
 if(prelockAllowed&&predictionReady&&userMarkReady&&decisionReady)nextAction='READY_PRE_RACE';
 if(alertStatus==='BLOCK'&&cardComplete&&predictionReady)nextAction='RESOLVE_BLOCKER';
 const preRaceReady=cardComplete&&prelockAllowed&&predictionReady&&userMarkReady&&decisionReady&&alertStatus!=='BLOCK';
 return{cardComplete,prelockAllowed,predictionReady,userMarkReady,decisionReady,alertStatus,preRaceReady,nextAction,
  guardrails:{genericRaceIdentity:true,officialCardBeforeLock:true,noResultRequiredForPreRace:true,noSyntheticLiveFeeds:true}};
}
