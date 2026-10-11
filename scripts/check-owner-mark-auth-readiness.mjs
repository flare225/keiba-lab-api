import {pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';

export const APP_URL='https://keiba-lab-apl.vercel.app/v1/lab/user-mark-session';
export const WORKER_URL='https://keiba-lab-api.sekai-no-bancyou.workers.dev/v1/lab/user-mark-capabilities';

export function evaluateMarkAuthReadiness(app,worker){
 const errors=[];
 const configuration=app?.configuration;
 const configKeys=['ownerPassphraseReady','sessionSecretReady','writeTokenReady'];
 const hasDetails=configuration&&configKeys.every(k=>typeof configuration[k]==='boolean');
 if(app?.ok!==true||typeof app.configured!=='boolean'||typeof app.authenticated!=='boolean')
  errors.push('Vercel owner-session endpoint unavailable or unexpected response');
 else if(hasDetails){
  const labels={
   ownerPassphraseReady:'Vercel owner passphrase missing or below minimum length',
   sessionSecretReady:'Vercel session secret missing or below minimum length',
   writeTokenReady:'Vercel DB write token missing or below minimum length'
  };
  for(const key of configKeys)if(!configuration[key])errors.push(labels[key]);
  if(app.configured!==configKeys.every(k=>configuration[k]))errors.push('Vercel configuration summary inconsistent');
 }else if(!app.configured)errors.push('Vercel owner credentials or write token missing');
 if(worker?.ok!==true||typeof worker.writeReady!=='boolean')
  errors.push('Cloudflare Worker write-capabilities endpoint unavailable or unexpected response');
 else if(!worker.writeReady)errors.push('Cloudflare Worker USER_MARK_WRITE_TOKEN missing or Worker update not published');
 return {ready:errors.length===0,
  appConfigured:app?.ok===true&&app.configured===true,
  appConfiguration:hasDetails?Object.fromEntries(configKeys.map(k=>[k,configuration[k]])):null,
  workerWriteReady:worker?.ok===true&&worker.writeReady===true,
  errors,
  actualWriteVerified:false,
  note:'Configuration check ONLY. This does not save marks or prove token matching, D1 write, readback, or pre-race LOCK.'};
}
export async function readJson(url,fetcher=fetch){
 const response=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',
  headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('HTTP '+response.status);
 const type=response.headers?.get?.('content-type')||'';
 if(!type.includes('json'))throw Error('Unexpected non-JSON response');
 return response.json();
}
export async function checkLive(fetcher=fetch){
 const result=await Promise.allSettled([readJson(APP_URL,fetcher),readJson(WORKER_URL,fetcher)]);
 const app=result[0].status==='fulfilled'?result[0].value:null;
 const worker=result[1].status==='fulfilled'?result[1].value:null;
 const readiness=evaluateMarkAuthReadiness(app,worker);
 if(result[0].status==='rejected')readiness.errors.push('Vercel session read failed: '+String(result[0].reason?.message||result[0].reason).slice(0,90));
 if(result[1].status==='rejected')readiness.errors.push('Worker capabilities read failed: '+String(result[1].reason?.message||result[1].reason).slice(0,90));
 readiness.ready=readiness.errors.length===0;
 return readiness;
}
export function summaryLines(r){
 const status=value=>value===true?'ready':value===false?'BLOCKED':'not reported';
 return [
  '## KEIBA LABO owner mark-save authentication readiness (GET only)',
  '| Check | Status |','|---|---|',
  '| Vercel owner passphrase | '+status(r.appConfiguration?.ownerPassphraseReady)+' |',
  '| Vercel session secret | '+status(r.appConfiguration?.sessionSecretReady)+' |',
  '| Vercel DB write token | '+status(r.appConfiguration?.writeTokenReady)+' |',
  '| Vercel owner session configuration | '+(r.appConfigured?'configured':'BLOCKED')+' |',
  '| Cloudflare Worker write-token configuration | '+(r.workerWriteReady?'configured':'BLOCKED')+' |',
  '| Real DB write/readback test | NOT RUN; requires user authentication and approved test |',
  '',
  ...(r.errors.length?['**BLOCKED**: '+r.errors.join('; ')]:['**CONFIGURATION READY**: Write permissions and token matching still require an authenticated end-to-end test.']),
  '',
  'No user credentials, passwords, tokens, horse names, DB rows, or mark revisions were requested or printed.',
  'Set secrets only in provider dashboards. [Read operator instructions](https://github.com/flare225/keiba-lab-api/blob/main/docs/owner-mark-auth-setup.md).'
 ];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const r=await checkLive();
 const lines=summaryLines(r);
 console.log(lines.join('\n'));
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
 if(!r.ready)process.exitCode=1;
}
