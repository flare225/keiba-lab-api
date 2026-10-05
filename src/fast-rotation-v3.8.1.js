import app from './index-v3.8.0.js';
import {ingestDay} from './index-v3.7.1.js';

export const ROTATION_VERSION='3.8.1';

function todayJst(){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}

function addUtcDays(date,days){
  const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}

export function rotationPairs(dateCount,hour){
  if(dateCount<=0)return[];
  if(dateCount<3){
    const slot=((hour%3)+3)%3;
    return Array.from({length:dateCount},(_,dateIndex)=>({dateIndex,slot}));
  }
  const phases=[
    [{dateIndex:0,slot:0},{dateIndex:1,slot:0}],
    [{dateIndex:2,slot:0},{dateIndex:0,slot:1}],
    [{dateIndex:1,slot:1},{dateIndex:2,slot:1}],
    [{dateIndex:0,slot:2},{dateIndex:1,slot:2}],
    [{dateIndex:2,slot:2}],
  ];
  return phases[((hour%5)+5)%5];
}

export async function runScheduledFast(event,env,ctx,deps={stage:app.fetch,ingest:ingestDay,today:todayJst}){
  const date=deps.today();
  const upcoming=Array.from({length:8},(_,i)=>addUtcDays(date,i));
  const stageResponse=await deps.stage(new Request(`https://keiba-lab.internal/v1/lab/meeting-prep?dates=${upcoming.join(',')}`),env,ctx);
  const staging=await stageResponse.json();
  if(!stageResponse.ok||!staging.ok)throw new Error(`Program staging failed: ${staging.error||'no successful dates'}`);

  const dates=(await env.DB.prepare('SELECT DISTINCT race_date FROM jra_race_program WHERE race_date>=? ORDER BY race_date LIMIT 3').bind(date).all()).results||[];
  const hour=Math.floor(Number(event.scheduledTime)/3600000);
  const pairs=rotationPairs(dates.length,hour);
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
    rotationPolicy:dates.length===3?'all 72 date/slot combinations covered once within any complete 5-hour phase cycle':'all available dates are swept across three 8-card slots within 3 hours',
    staging:{successfulDates:staging.successfulDates,totalProgramRaces:staging.totalProgramRaces,runs:staging.runs},
    pairs:pairs.map(p=>({date:dates[p.dateIndex]?.race_date||null,slot:p.slot,cursor:p.slot*8})),
    runs,
  };
}
