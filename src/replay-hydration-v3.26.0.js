export function shouldHydrateReplay(payload){
  return payload?.ok===true
    && payload?.evidence?.grade==='NO_RECORD'
    && payload?.replay?.available===false
    && /no evidence score|complete runner coverage unavailable/i.test(String(payload?.replay?.reason||''));
}
export function hydrationGuard(date){
  return {
    sourcePurpose:'runner profile discovery + prior-race history only',
    targetRaceOutcomeQueried:false,
    targetRaceResultFieldsStored:false,
    targetRaceOddsStored:false,
    targetRaceBodyWeightStored:false,
    acceptedHistoryRule:'race_date < '+date,
    postRaceHydrationExplicit:true,
    prospectiveAccuracyCredit:false
  };
}
