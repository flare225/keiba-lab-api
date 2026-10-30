// Identity facts checked on the official individual pages, not generated from
// secondary horse IDs. These facts do not establish entries, form or predictions.
export const REVIEWED_JRA_PROFILES = [
 ['サクラファレル','2022-04-07','pw01dud002022104094/EE'],
 ['タガノデュード','2021-04-18','pw01dud102021106548/98'],
 ['ネブラディスク','2022-03-22','pw01dud102022105140/D9'],
 ['ジュンブロッサム','2019-04-15','pw01dud102019105118/AA']
].map(([horseName,birthDate,cname])=>Object.freeze({horseName,birthDate,
 profileUrl:'https://www.jra.go.jp/JRADB/accessU.html?CNAME='+cname,
 observedAt:'2026-10-28T23:00:00.000Z',
 evidence:'Official individual profile heading, age and full birth date reviewed; original HTML not retained.'}));

export function reviewedJraProfiles(source, records=REVIEWED_JRA_PROFILES,now=Date.now()){
 const links=new Map(),target=Date.parse(source.date+'T00:00:00+09:00');
 for(const record of records){
  if(!source.names.includes(record.horseName))continue;
  const birth=Date.parse(record.birthDate),observed=Date.parse(record.observedAt);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(record.birthDate)||!Number.isFinite(birth)||new Date(birth).toISOString().slice(0,10)!==record.birthDate||!Number.isFinite(observed)||observed>=target||observed>now)continue;
  const age=Number(source.ages?.[record.horseName]??source.age);
  if(Number(source.date.slice(0,4))-Number(record.birthDate.slice(0,4))!==age)continue;
  let url;try{url=new URL(record.profileUrl);}catch{continue;}
  if(url.protocol!=='https:'||url.hostname!=='www.jra.go.jp'||url.port||url.username||url.password||url.hash||url.pathname!=='/JRADB/accessU.html'||[...url.searchParams.keys()].some(k=>k!=='CNAME')||url.searchParams.getAll('CNAME').length!==1||!/^pw01dud\d{12}\/[A-F0-9]{2}$/.test(url.searchParams.get('CNAME')||''))continue;
  const prior=links.get(record.horseName);
  // Conflicting reviewed identities stay unavailable; do not choose a winner.
  links.set(record.horseName,prior===null||prior&&(prior.profileUrl!==record.profileUrl||prior.birthDate!==record.birthDate)?null:record);
 }
 return links;
}

export function assertReviewedProfileIdentity(html,record){
 const strip=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
 const headings=[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m=>strip(m[1]));
 const escaped=record.horseName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(!headings.some(h=>new RegExp('^(?:競走馬情報\\s*)?'+escaped+'(?:\\s|[A-Za-z（(]|$)').test(h)))throw Error('確認済みプロフィールの見出し馬名が一致しません。');
 const [y,m,d]=record.birthDate.split('-').map(Number);
 if(!new RegExp('生年月日\\s*'+y+'年\\s*'+m+'月\\s*'+d+'日').test(strip(html)))throw Error('確認済みプロフィールの生年月日が一致しません。');
}
