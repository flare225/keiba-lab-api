export const COLLECTION_READ_POLICY={version:'conservative-read-cadence-v1',sourceRunsPerHour:10,learningRunsPerHour:1,priorDetailRunsPerHour:5,additionalHourlyJobsPreserved:true,sharedJraCooldownUnchanged:true,userMarkWritesThrottled:false,dailyRowsReadMeasured:false,dailyQuotaStopGuaranteed:false};
export function shouldRunScheduled(event){
 const stamp=Number(event.scheduledTime);if(!Number.isFinite(stamp))return false;
 const minute=new Date(stamp).getUTCMinutes();
 if(event.cron==='*/3 * * * *')return minute%6===0;
 if(event.cron==='0,10,20,30,40,50 * * * *')return minute===0;
 return true;
}
