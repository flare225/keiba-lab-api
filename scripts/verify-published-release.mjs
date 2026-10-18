import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const endpoint='https://keiba-lab-api.sekai-no-bancyou.workers.dev/v1/lab/deploy-check';

export async function expectedRelease(root='.'){
 const config=await readFile(root+'/wrangler.jsonc','utf8');
 const entry=config.match(/"main"\s*:\s*"([^"]+)"/);
 if(!entry)throw Error('Worker entrypoint is missing');
 const source=await readFile(root+'/'+entry[1],'utf8');
 const version=source.match(/export const VERSION\s*=\s*['"]([^'"]+)['"]/);
 if(!version)throw Error('Worker version is missing');
 return version[1];
}

// This checks release identity only. Persistence and model quality require their
// own explicit checks. No retries, redirects, historical dates or D1 endpoints.
export async function verifyPublishedRelease(expectedVersion,{fetcher=globalThis.fetch}={}){
 const response=await fetcher(endpoint,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Release identity check blocked: HTTP '+response.status+'; no retry performed');
 let body;try{body=await response.json();}catch{throw Error('Release identity response is not JSON')}
 if(body?.ok!==true||body.version!==expectedVersion)throw Error('Published release identity does not match tested source');
 return{ok:true,version:body.version,scope:'release-identity-only',databaseVerified:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await verifyPublishedRelease(await expectedRelease())))}
 catch(error){console.error(error.message);process.exitCode=1}
}
