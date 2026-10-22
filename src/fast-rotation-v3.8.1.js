import app from './index-v3.8.0.js';
import {boundedProgramSweep} from './bounded-program-sweep.js';

export const ROTATION_VERSION='3.8.1';

function todayJst(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function addUtcDays(date,days){
  const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}

export function rotationPairs(dateCount,hour,slots=3){
  if(dateCount<=0)return[];
  if(dateCount<3){
    const slot=((hour%slots)+slots)%slots;
    return Array.from({length:dateCount},(_,dateIndex)=>({dateIndex,slot}));
  }
  const pairs=Array.from({length:slots*dateCount},(_,i)=>({dateIndex:i%dateCount,slot:Math.floor(i/dateCount)}));
  const phases=Math.ceil(pairs.length/2),phase=((hour%phases)+phases)%phases;
  return pairs.slice(phase*2,phase*2+2);
}

export async function runScheduledFast(event,env,ctx,deps={}){
 // The active Worker already recovers programs inside the bounded common lane.
 // Preserve the legacy audit and all other inherited work, not a second fetch.
 if(env.LAB_COMMON_PROGRAM_RECOVERY===true)return{ok:true,status:'legacy-program-sweep-delegated',externalRequests:0,runs:[]};
 return boundedProgramSweep(event,env,ctx,{...deps,stage:deps.stage||app.fetch});
}
