import {canonicalPublishedPage,SHARED_PAGE_POLICY} from './shared-page-acquisition.js';
import {extractLinks,metaFromRacecardUrl} from './index-v1.1.4.js';
import {sha256} from './card-evidence.js';

// Diagnose an existing exact scope/URL receipt; never enqueue, fetch or reparse it.
export async function readSharedPageEvidence(db,{scope,pageUrl,includeBody=false}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(scope||'')||new Date(scope+'T00:00:00Z').toISOString().slice(0,10)!==scope)throw Error('Exact shared-page scope required');
 const url=canonicalPublishedPage(pageUrl);let row;
 try{row=await db.prepare(`SELECT p.status,p.next_at,p.error,p.body_sha,p.parser_version,b.body_html,b.byte_length,b.observed_at,b.http_status,b.charset,b.received_bytes FROM lab_shared_page_receipts_v1 p LEFT JOIN lab_shared_page_bodies_v1 b ON b.scope_key=p.scope_key AND b.page_url=p.page_url AND b.sha256=p.body_sha WHERE p.scope_key=? AND p.page_url=? LIMIT 1`).bind(scope,url).first();}
 catch(e){if(!/no such table/.test(String(e)))throw e;return{ok:true,available:false,scope,pageUrl:url};}
 if(!row)return{ok:true,available:false,scope,pageUrl:url};
 const result={ok:true,available:true,scope,pageUrl:url,status:row.status,error:row.error||null,nextAttemptAt:row.next_at?new Date(Number(row.next_at)).toISOString():null,bodySha256:row.body_sha||null,bodyAvailable:typeof row.body_html==='string',parserVersion:row.parser_version,externalRequests:0,readOnly:true};
 if(!result.bodyAvailable){if(row.body_sha)throw Error('Stored shared source body is missing');return result;}
 const html=row.body_html,bytes=new TextEncoder().encode(html).length;
 if(bytes>6000000||bytes!==row.byte_length||await sha256(html)!==row.body_sha)throw Error('Stored shared source body bound or hash mismatch');
 const links=extractLinks(html,url),supported=new Set(),cards=new Set(),other=[];let supportedRawLinkCount=0,otherLinkCount=0;
 for(const link of links){try{const u=canonicalPublishedPage(link);supportedRawLinkCount++;supported.add(u);if(metaFromRacecardUrl(u))cards.add(u);}catch{otherLinkCount++;if(other.length<8)other.push(link);}}
 const title=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g,' ').trim()||null;
 return{...result,integrityVerified:true,hashBasis:'complete-decoded-html-utf8',bodyBytes:bytes,receivedBytes:row.received_bytes,decodedCharset:row.charset,httpStatus:row.http_status,observedAt:new Date(Number(row.observed_at)).toISOString(),title,
  extractedLinkCount:links.length,publishedLinkLimit:SHARED_PAGE_POLICY.maxLinks,linkLimitBasis:'supported-unique-acquisition-pages',existingParserWouldReject:supported.size>SHARED_PAGE_POLICY.maxLinks,supportedRawLinkCount,supportedUniquePageCount:supported.size,cardLinkCount:cards.size,otherLinkCount,
  supportedSamples:[...supported].slice(0,16),otherSamples:other,fullBodyIncluded:includeBody,...(includeBody?{bodyHtml:html}:{}),findingsWritten:false};
}
