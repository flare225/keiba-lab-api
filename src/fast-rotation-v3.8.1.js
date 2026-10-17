import app from './index-v3.8.0.js';
import {ingestDay} from './index-v3.7.1.js';

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

export async function runScheduledFast(event,env,ctx,deps={stage:app.fetch,ingest:ingestDay,today:todayJst}){
  const date=deps.today();
  const upcoming=Array.from({length:8},(_,i)=>addUtcDays(date,i));
  const stageResponse=await deps.stage(new Request(`https://keiba-lab.internal/v1/lab/meeting-prep?dates=${upcoming.join(',')}`),env,ctx);
  const staging=await stageResponse.json();
  if(!stageResponse.ok||!staging.ok)throw new Error(`Program staging failed: ${staging.error||'no successful dates'}`);

  const dates=(await env.DB.prepare('SELECT race_date,COUNT(*) AS race_count FROM jra_race_program WHERE race_date>=? GROUP BY race_date ORDER BY race_date LIMIT 3').bind(date).all()).results||[];
  const hour=Math.floor(Number(event.scheduledTime)/3600000);
  const slots=Math.max(1,...dates.map(r=>Math.ceil(Number(r.race_count||24)/8)));
  const pairs=rotationPairs(dates.length,hour,slots).filter(p=>p.slot*8<Number(dates[p.dateIndex]?.race_count||24));
  const runs=[];

  for(const pair of pairs){
    const row=dates[pair.dateIndex];if(!row)continue;
    const cursor=pair.slot*8;
    try{
      const result=await deps.ingest(new Request(`https://keiba-lab.internal/v1/lab/card-ingest?date=${row.race_date}&cursor=${cursor}&limit=8`),env,ctx);
      runs.push({...result,rotationSlot:pair.slot});
    }catch(error){
      console.error('fast card ingestion failed',row.race_date,cursor,String(error));
      runs.push({date:row.race_date,cursor,rotationSlot:pair.slot,ok:false,error:String(error)});
    }
  }

  return{
    date,
    rotationVersion:ROTATION_VERSION,
    rotationPolicy:'dynamic program counts; every 8-card slot included, at most two batches per run',
    staging:{successfulDates:staging.successfulDates,totalProgramRaces:staging.totalProgramRaces,runs:staging.runs},
    pairs:pairs.map(p=>({date:dates[p.dateIndex]?.race_date||null,slot:p.slot,cursor:p.slot*8})),
    runs,
  };
}
