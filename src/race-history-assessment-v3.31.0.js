import {EXPECTED_SOURCES,historyForExpected} from './expected-runner-preview-v3.30.0.js';
import {assessExpectedHistory,rankAssessment,expectedAssessment} from './expected-assessment-v3.31.0.js';
export function targetInput(input){
 const date=String(input.date||''),venue=String(input.venue||''),raceNo=Number(input.raceNo??input.race_no);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||!['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'].includes(venue)||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw Error('対象日・競馬場・レース番号を確認してください。');
 return{date,venue,raceNo};
}
export async function assessmentContext(db,input){
 const t=targetInput(input);
 const race=await db.prepare('SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count FROM jra_races WHERE race_date=? AND venue=? AND race_no=?').bind(t.date,t.venue,t.raceNo).first();
 if(!race){const expected=EXPECTED_SOURCES.find(s=>s.date===t.date&&s.venue===t.venue&&s.raceNo===t.raceNo);if(expected)return{...expected,official:false};throw Error('正式出馬表がまだ保存されていません。出馬表の取り込み後に精査できます。')}
 const runners=(await db.prepare('SELECT horse_no,horse_name,age FROM jra_runners WHERE race_key=? ORDER BY horse_no').bind(race.race_key).all()).results||[];
 if(!runners.length||runners.length!==Number(race.runner_count)||new Set(runners.map(r=>r.horse_name)).size!==runners.length)throw Error('正式出馬表の保存が不完全です。精査を保留します。');
 if(!['芝','ダート','障害','障害芝','障害ダート','芝・ダート'].includes(race.surface)||!Number.isFinite(Number(race.distance))||Number(race.distance)<=0)throw Error('芝・ダートと距離のデータを確認できません。精査を保留します。');
 return{raceKey:race.race_key,...t,raceName:race.race_name,surface:race.surface,distance:Number(race.distance),names:runners.map(r=>r.horse_name),runners,official:true,provider:'stored-JRA-card',snapshotId:null};
}
export async function raceHistoryAssessment(db,input){
 const context=await assessmentContext(db,input);
 if(!context.official)return expectedAssessment(db,input);
 if(input.track&&!['良','稍重','重','不良'].includes(input.track))throw Error('想定馬場を確認してください。');
 if(!Array.isArray(input.marks)||input.marks.length<1||input.marks.length>18)throw Error('印を1頭以上指定してください。');
 const seen=new Set();const marks=input.marks.map(m=>{const horseName=String(m.horseName||'').trim(),runner=context.runners.find(r=>r.horse_name===horseName);if(!runner||!['◎','○','▲','△','☆','注','消'].includes(m.mark)||seen.has(horseName))throw Error('馬名・初期印・重複を確認してください。');if(m.horseNo!=null&&Number(m.horseNo)!==Number(runner.horse_no))throw Error('馬番と馬名が一致しません。');seen.add(horseName);return{horseName,horseNo:Number(runner.horse_no),mark:m.mark,laboScore:null,laboRank:null}});
 const histories=[];
 for(const runner of context.runners){
  if(!Number.isInteger(Number(runner.age))||Number(runner.age)<2||Number(runner.age)>20)throw Error('出走馬の年齢データを確認できません。精査を保留します。');
  const supplement=EXPECTED_SOURCES.find(s=>s.raceKey===context.raceKey&&s.names.includes(runner.horse_name));
  histories.push(await historyForExpected(db,{...context,age:Number(runner.age),snapshotId:supplement?.snapshotId||'no-expected-supplement'},runner.horse_name));
 }
 const byHistory=new Map(histories.map(h=>[h.horseName,h]));
 const all=rankAssessment(context.runners.map(r=>({horseName:r.horse_name,horseNo:Number(r.horse_no),assessment:assessExpectedHistory(byHistory.get(r.horse_name),context,input.track||null)})));
 const byName=new Map(all.map(x=>[x.horseName,x]));
 return{ok:true,stage:'all-race-history-assessment',phase:'initial',race:{raceKey:context.raceKey,date:context.date,venue:context.venue,raceNo:context.raceNo,raceName:context.raceName,surface:context.surface,distance:context.distance},source:{provider:context.provider,authoritativeForCard:true},
  audit:{mode:'official-card-history-assessment',marked:marks,historySidecar:marks.map(m=>byHistory.get(m.horseName))},scoreMutation:false,
  assessment:{modelVersion:'existing-safe-core-1.5-history-adapter-v1',trackAssumption:input.track||null,trackBasis:input.track?'user-scenario-not-confirmed-race-day-track':'unknown',runnerPool:all.length,scoredRunners:all.filter(r=>r.assessment.available).length,marked:marks.map(m=>({...byName.get(m.horseName),humanMark:m.mark})),allRunners:all,guardrails:{fullOfficialRunnerPool:true,humanMarksUsedInScore:false,noExternalFetch:true,lockedPredictionsModified:false,noForcedTieBreak:true,accuracyImprovementValidated:false,automaticMarksAssigned:false,targetResultUsed:false}}};
}
