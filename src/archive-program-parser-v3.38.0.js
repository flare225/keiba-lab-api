const VENUES="札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉";
function decodeEntities(s){return String(s||"").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#44;/gi,",").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))}
function structuredText(html){return decodeEntities(String(html||"")
  .replace(/<script[\s\S]*?<\/script>/gi," ")
  .replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<br\s*\/?\s*>/gi,"\n")
  .replace(/<\/(?:tr|table|thead|tbody|tfoot|h[1-6]|section|article|li|p)>/gi,"\n")
  .replace(/<\/(?:div|dl|dt|dd)>/gi,"\n")
  .replace(/<[^>]+>/g," "))
  .split(/\r?\n/)
  .map(x=>x.replace(/[\u3000\t ]+/g," ").trim())
  .filter(Boolean)
  .join("\n");}
function flatText(s){return String(s||"").replace(/\n+/g," ").replace(/\s+/g," ").replace(/([0-9]),([0-9]{3})/g,"$1$2").trim()}
function parseLabel(label){const t=String(label||"").replace(/([0-9]),([0-9]{3})/g,"$1$2").replace(/\s+/g," ").trim();const c=t.match(/([123]\d{3})\s*[（(]\s*(芝(?:・外)?|ダ|障害)\s*[）)]/);const raw=c?.[2]||null;const surface=raw?.startsWith("芝")?"芝":raw==="ダ"?"ダート":raw||null;const distance=c?Number(c[1]):null;const grade=(t.match(/[（(]\s*(GⅠ|GⅡ|GⅢ|L)\s*[）)]/)||[])[1]||null;return{label:t,surface,distance,grade}}
function rowToRace(line,current,date,sourceUrl){const s=String(line||"").replace(/([0-9]),([0-9]{3})/g,"$1$2").replace(/\s+/g," ").trim();const m=s.match(/(?:^|\s)([1-9]|1[0-2])\s*レース\s+(.+?)\s+(\d{1,2})\s*時\s*(\d{2})\s*分(?:\s|$)/);if(!m||!current)return null;const raceNo=Number(m[1]),p=parseLabel(m[2]);return{programKey:`${date}:${current.venue}:${raceNo}`,date,venue:current.venue,meetingNo:current.meetingNo,dayNo:current.dayNo,raceNo,raceLabel:p.label,surface:p.surface,distance:p.distance,startTime:`${m[3].padStart(2,"0")}:${m[4]}`,grade:p.grade,sourceUrl}}
function parseStructured(html,date,sourceUrl){const txt=structuredText(html);const lines=txt.split("\n");const races=[];const seen=new Set();const headers=[];let current=null;const vre=new RegExp(`(\\d+)\\s*回\\s*(${VENUES})\\s*(\\d+)\\s*日`);for(const line of lines){const vm=line.match(vre);if(vm){current={meetingNo:Number(vm[1]),venue:vm[2],dayNo:Number(vm[3])};headers.push({...current,line});continue}const r=rowToRace(line,current,date,sourceUrl);if(r&&!seen.has(r.programKey)){seen.add(r.programKey);races.push(r)}}return{races,headers,textSample:lines.slice(Math.max(0,lines.findIndex(x=>x.includes("競馬番組"))),Math.max(0,lines.findIndex(x=>x.includes("競馬番組")))+35)}}
function parseFlat(html,date,sourceUrl){const text=flatText(structuredText(html));const vre=new RegExp(`(\\d+)\\s*回\\s*(${VENUES})\\s*(\\d+)\\s*日`,`g`);const headers=[];let m;while((m=vre.exec(text)))headers.push({index:m.index,meetingNo:Number(m[1]),venue:m[2],dayNo:Number(m[3])});const races=[],seen=new Set();for(let i=0;i<headers.length;i++){const h=headers[i],end=i+1<headers.length?headers[i+1].index:text.length,section=text.slice(h.index,end);const rr=/([1-9]|1[0-2])\s*レース\s+([\s\S]*?)\s+(\d{1,2})\s*時\s*(\d{2})\s*分/g;let r;while((r=rr.exec(section))){const raceNo=Number(r[1]);const p=parseLabel(r[2]);const key=`${date}:${h.venue}:${raceNo}`;if(seen.has(key)||!p.label||p.label.length>240)continue;seen.add(key);races.push({programKey:key,date,venue:h.venue,meetingNo:h.meetingNo,dayNo:h.dayNo,raceNo,raceLabel:p.label,surface:p.surface,distance:p.distance,startTime:`${r[3].padStart(2,"0")}:${r[4]}`,grade:p.grade,sourceUrl})}}return{races,headers,textSample:text.slice(Math.max(0,text.indexOf("競馬番組")),Math.max(0,text.indexOf("競馬番組"))+1000)}}
function parseBest(body,date,sourceUrl){const a=parseStructured(body,date,sourceUrl),b=parseFlat(body,date,sourceUrl);return b.races.length>a.races.length?{...b,parser:"flat-section"}:{...a,parser:"structured-lines"}}

export const parseArchiveProgram=(html,date,url)=>parseBest(html,date,url).races;
