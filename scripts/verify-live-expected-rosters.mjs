import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('browser-evidence',{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:412,height:915},timezoneId:'Asia/Tokyo'});
await context.addInitScript(()=>localStorage.setItem('keiba-labo:active-race:v1',JSON.stringify({date:'2026-10-25',venue:'京都',raceNo:11})));
const page=await context.newPage(),errors=[],writes=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',async route=>{const req=route.request();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push({method:req.method(),url:req.url()});return route.abort();}return route.continue();});
const results=[];
try{
 await page.goto('https://keiba-lab-apl.vercel.app/',{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>typeof window.selectLaboRace==='function',null,{timeout:45000});
 await page.waitForFunction(()=>document.querySelectorAll('#expectedInlineRoster select[data-horse-name]').length===21,null,{timeout:45000});
 for(const t of [{date:'2026-10-24',venue:'東京',raceNo:11,count:14},{date:'2026-10-25',venue:'京都',raceNo:11,count:21}]){
  const responsePromise=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/v1/lab/expected-runners'&&u.searchParams.get('date')===t.date&&u.searchParams.get('venue')===t.venue},{timeout:45000});
  await page.evaluate(t=>window.selectLaboRace(t.date,t.venue,t.raceNo),t);
  const response=await responsePromise,db=await response.json();
  await page.locator('.tab[data-id="marks"]').click();
  await page.waitForFunction(t=>window.getLaboTarget?.().date===t.date&&window.getLaboTarget?.().venue===t.venue&&document.querySelectorAll('#expectedInlineRoster select[data-horse-name]').length===t.count,t,{timeout:45000});
  const panel=page.locator('#expectedInlineRoster');await panel.waitFor({state:'visible'});
  const visible=await panel.locator('select[data-horse-name]').evaluateAll(xs=>xs.map(x=>x.dataset.horseName));
  if(response.status()!==200||visible.length!==t.count||JSON.stringify([...visible].sort())!==JSON.stringify(db.runners.map(x=>x.horseName).sort()))throw Error('Rendered roster differs from saved source');
  const title=await panel.locator('h3').innerText();if(!title.includes(t.date)||!title.includes(t.venue))throw Error('Stale roster title');
  await panel.screenshot({path:'browser-evidence/'+t.date+'-'+t.venue+'.png'});
  const result={target:t,title,renderedNames:visible,snapshotId:db.source.snapshotId,readbackMatches:true};results.push(result);console.log('BROWSER_ROSTER_VERIFIED',JSON.stringify(result));
 }
}finally{
 await page.screenshot({path:'browser-evidence/final-page.png',fullPage:true}).catch(()=>{});
 await writeFile('browser-evidence/results.json',JSON.stringify({results,pageErrors:errors,blockedWrites:writes},null,2));
 console.log('BROWSER_SUMMARY',JSON.stringify({verified:results.length,pageErrors:errors,blockedWrites:writes}));
 await browser.close();
}
if(results.length!==2)throw Error('Both live rosters must render');
