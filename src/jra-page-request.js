// Use the published JRADB form endpoint. No alternate hosts, credentials, or retries.
export function jraPageRequest(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||!['www.jra.go.jp','jra.go.jp','www.jra.jp','jra.jp'].includes(u.hostname)||u.username||u.password)throw Error('JRAの取得元URL以外は使用できません。');
 const headers={accept:'text/html'};
 if(/^\/JRADB\/access[USD]\.html$/i.test(u.pathname)&&u.searchParams.has('CNAME')){
  headers['content-type']='application/x-www-form-urlencoded';
  return {url:u.origin+u.pathname,options:{method:'POST',headers,body:u.searchParams.toString(),redirect:'follow',signal:AbortSignal.timeout(10000)}};
 }
 return {url:u.href,options:{method:'GET',headers,redirect:'follow',signal:AbortSignal.timeout(10000)}};
}
export const isJraSourceBlocked=status=>[403,429,503].includes(Number(status));
