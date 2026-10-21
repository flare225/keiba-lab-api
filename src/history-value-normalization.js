// Equivalence only. Unknown strings remain distinct; no numeric value is inferred.
export const HISTORY_VALUE_POLICY='source-format-equivalence-v1';
export function comparableHistoryValue(field,value){
 if(value==null)return value;
 if(field==='surface')return({'ダ':'ダート','ダート':'ダート','芝':'芝','障':'障害','障害':'障害'})[value]??value;
 if(field==='trackCondition')return({'稍':'稍重','稍重':'稍重','重':'重','不':'不良','不良':'不良','良':'良'})[value]??value;
 if(field==='cornerPositions'){
  const text=String(value).trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-65248));
  if(/^\d{1,2}(?:(?:\s*[-－–→/]\s*|\s+)\d{1,2}){1,3}$/.test(text)){const positions=text.match(/\d+/g).map(Number);if(positions.every(n=>n>=1&&n<=40))return positions.join('-');}return value;
 }
 if(field==='time'){
  const text=String(value).trim();if(/^\d{1,3}(?:\.\d{1,3})?$/.test(text))return Number(text);
  const m=text.match(/^(\d{1,2}):([0-5]\d(?:\.\d{1,3})?)$/);if(m)return Number(m[1])*60+Number(m[2]);
 }
 return value;
}
