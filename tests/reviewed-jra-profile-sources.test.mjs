import test from 'node:test';
import assert from 'node:assert/strict';
import {REVIEWED_JRA_PROFILES,reviewedJraProfiles,assertReviewedProfileIdentity} from '../src/reviewed-jra-profile-sources.js';
const fact=REVIEWED_JRA_PROFILES[0],source={date:'2026-11-01',names:[fact.horseName],ages:{[fact.horseName]:4}};
test('reviewed official identities match roster name and birth-year age without race-specific routing',()=>{
 for(const f of REVIEWED_JRA_PROFILES){const s={date:'2026-11-01',names:[f.horseName],age:2026-Number(f.birthDate.slice(0,4))};assert.equal(reviewedJraProfiles(s).get(f.horseName),f);}
 assert.equal(reviewedJraProfiles(source,undefined,Date.parse('2026-10-28T22:59:59Z')).size,0);
 assert.equal(reviewedJraProfiles({...source,date:'2026-10-28'}).size,0);
 assert.equal(reviewedJraProfiles({...source,ages:{[fact.horseName]:5}}).size,0);
 assert.equal(reviewedJraProfiles({...source,names:['Other']}).size,0);
 for(const profileUrl of ['https://own.netkeiba.com/db/horse.html?id=2022104094',fact.profileUrl+'#x',fact.profileUrl+'&other=x',fact.profileUrl.replace('https:','http:')])assert.equal(reviewedJraProfiles(source,[{...fact,profileUrl}]).size,0);
 assert.equal(reviewedJraProfiles(source,[fact,{...fact,profileUrl:REVIEWED_JRA_PROFILES[1].profileUrl}]).get(fact.horseName),null);
});
test('fetched reviewed identity requires own heading and exact birth date, not an opponent mention',()=>{
 const good='<h1><img alt="競走馬情報">サクラファレルSakura Farrel（JPN）</h1><dl><dt>生年月日</dt><dd>2022年4月7日</dd></dl>';
 assert.doesNotThrow(()=>assertReviewedProfileIdentity(good,fact));
 for(const bad of [good.replace('2022年4月7日','2022年4月8日'),good.replace('サクラファレルSakura','Other Sakura')+'サクラファレル',good.replace('<h1>','<div>').replace('</h1>','</div>')])assert.throws(()=>assertReviewedProfileIdentity(bad,fact));
});
