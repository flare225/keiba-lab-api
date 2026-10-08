import {EXPERIMENT,captureExperimentRace,fitExperiment} from './learning-experiment-v3.40.0.js';
import {jstDay} from './history-collection-v3.32.0.js';
export async function completeCollectedTraining(db,result,now=Date.now(),deps={}){
 const race=result.before?.race;
 if(!race||!result.results?.some(r=>r.savedRows>0)||race.date<EXPERIMENT.trainingFrom||race.date>=EXPERIMENT.validationFrom||race.date>=jstDay(now))return result;
 try{
  const captured=await (deps.capture||captureExperimentRace)(db,{date:race.date,venue:race.venue,raceNo:race.raceNo},now);
  const fit=['labels-saved','labels-already-saved'].includes(captured.status)?await (deps.fit||fitExperiment)(db,now):null;
  return {...result,learningCompletion:{...captured,...(fit?{fit}:{}),externalRequests:0}};
 }catch(error){return {...result,learningCompletion:{ok:false,status:'deferred',error:String(error.message||error),externalRequests:0}};}
}
