export function deriveIngestAudit({declared=0,stored=0,duplicateHorseNos=0,missingHorseNos=[],invalidHorseNos=[],sourceVerified=false,sourceFetchedAt=null}={}){
 const d=Number(declared||0),s=Number(stored||0),dup=Number(duplicateHorseNos||0);
 const missing=[...new Set((missingHorseNos||[]).map(Number).filter(Number.isInteger))];
 const invalid=[...new Set((invalidHorseNos||[]).map(Number).filter(Number.isInteger))];
 const countMatch=d>0&&s===d;
 const unique=dup===0;
 const numbersValid=invalid.length===0;
 const complete=missing.length===0;
 const sourceOk=sourceVerified===true;
 const passed=countMatch&&unique&&numbersValid&&complete&&sourceOk;
 const blockers=[];
 if(!countMatch)blockers.push(`runner-count mismatch declared=${d} stored=${s}`);
 if(!unique)blockers.push(`duplicate horse numbers=${dup}`);
 if(!numbersValid)blockers.push(`invalid horse numbers=${invalid.join(',')}`);
 if(!complete)blockers.push(`missing horse numbers=${missing.join(',')}`);
 if(!sourceOk)blockers.push('official source not verified');
 return{passed,countMatch,unique,numbersValid,complete,sourceVerified:sourceOk,sourceFetchedAt:sourceFetchedAt||null,declared:d,stored:s,blockers,next:passed?'labo-prelock':'repair-card-ingestion',guardrails:{failClosed:true,noPrelockOnPartialCard:true,noSyntheticSourceVerification:true}};
}
