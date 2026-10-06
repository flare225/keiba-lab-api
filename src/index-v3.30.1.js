import {ingestExpectedHistory} from './expected-history-snapshot-v3.30.0.js';
import app from './index-v3.29.0.js';
import {EXPECTED_SOURCES,sourceFor,expectedRunnerPreview,PREVIEW_GUARDS} from './expected-runner-preview-v3.30.0.js';
import {expectedPreviewPage} from './expected-preview-page-v3.30.0.js';
export const VERSION='3.30.1';
const H={'content-type':'application/json; charset=UTF-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'};
const json=(data,status=200)=>new Response(JSON.stringify(data,null,2),{status,headers:H});
export default{
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
  if(url.pathname==='/')return json({ok:true,service:'keiba-lab-api',version:VERSION,phase:'dated expected-runner source + read-only DB preview'});
  if(url.pathname==='/v1/lab/deploy-check')return json({ok:true,version:VERSION,build:'netkeiba-expected-runner-history-preview',now:new Date().toISOString()});
  if(url.pathname==='/lab/expected-preview'&&request.method==='GET')return new Response(expectedPreviewPage(),{headers:{'content-type':'text/html; charset=UTF-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
  if(url.pathname==='/v1/lab/expected-runners'&&request.method==='GET'){
   try{
    const source=url.searchParams.has('date')?sourceFor({date:url.searchParams.get('date'),venue:url.searchParams.get('venue'),raceNo:url.searchParams.get('race_no')}):EXPECTED_SOURCES[0];
    return json({ok:true,version:VERSION,source:{...source,names:undefined},runners:source.names.map(horseName=>({horseName,horseNo:null,age:source.age})),guardrails:PREVIEW_GUARDS});
   }catch(error){return json({ok:false,version:VERSION,error:String(error.message||error)},400)}
  }
  if(url.pathname==='/v1/lab/expected-history-ingest'&&request.method==='POST'){
   try{const body=await request.json();if(body.confirm!=='INGEST')return json({ok:false,error:'confirm INGEST is required'},400);return json({...await ingestExpectedHistory(env.DB,sourceFor(body)),version:VERSION})}catch(error){return json({ok:false,error:String(error.message||error)},400)}
  }
  if(url.pathname==='/v1/lab/expected-runner-preview'&&request.method==='POST'){
   let body;try{body=await request.json()}catch{return json({ok:false,version:VERSION,error:'入力データを読み込めませんでした。'},400)}
   try{return json({...await expectedRunnerPreview(env.DB,body),version:VERSION})}
   catch(error){const message=String(error.message||error);return json({ok:false,version:VERSION,error:message,guardrails:PREVIEW_GUARDS},/過去DB/.test(message)?503:400)}
  }
  const response=await app.fetch(request,env,ctx);let data;
  try{data=await response.clone().json()}catch{return response}
  if(data&&typeof data==='object')data.version=VERSION;
  return json(data,response.status);
 },
 async scheduled(event,env,ctx){return app.scheduled(event,env,ctx)}
};

