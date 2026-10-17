// Cache only repeatable, read-only status snapshots at the edge. This keeps
// dashboard refreshes from turning into repeated D1 scans during race day.
const STATUS_PATHS=new Set([
 '/v1/lab/expected-history-status',
 '/v1/lab/pipeline-status',
 '/v1/lab/learning-experiment',
 '/v1/lab/work-progress',
 '/v1/lab/learning-source-track'
]);
export const STATUS_CACHE_SECONDS=30;
export function statusCacheKey(request){
 if(request.method!=='GET')return null;
 const url=new URL(request.url);
 if(!STATUS_PATHS.has(url.pathname))return null;
 return new Request(url.toString(),{method:'GET'});
}
export async function readStatusCache(cache,key){
 if(!cache||!key)return null;
 try{return await cache.match(key)}catch{return null}
}
export async function writeStatusCache(cache,key,response){
 if(!cache||!key||!response?.ok)return false;
 try{
  const headers=new Headers(response.headers);
  headers.set('cache-control',`public, max-age=${STATUS_CACHE_SECONDS}`);
  const body=await response.clone().arrayBuffer();
  await cache.put(key,new Response(body,{status:response.status,statusText:response.statusText,headers}));
  return true;
 }catch{return false}
}
