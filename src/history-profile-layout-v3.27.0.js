export function decodeJraProfileRaceCells(cells=[]){
 const int=v=>{const m=String(v??'').match(/-?\d+/);return m?Number(m[0]):null};
 const num=v=>{const m=String(v??'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null};
 const body=String(cells[10]??'');const wm=body.match(/(\d{3})/),cm=body.match(/[（(]\s*([+-]?\d+)\s*[）)]/);
 const finish=String(cells[7]??'').trim();
 return{fieldSize:int(cells[5]),popularity:int(cells[6]),finishPosition:/^\d+$/.test(finish)?Number(finish):null,finishStatus:/^\d+$/.test(finish)?null:(finish||null),jockey:String(cells[8]??'').trim()||null,assignedWeight:num(cells[9]),bodyWeight:wm?Number(wm[1]):null,bodyWeightChange:cm?Number(cm[1]):null,timeText:String(cells[11]??'').trim()||null,rating:num(cells[12]),last3f:null};
}
export function profileLayoutSane(x){return !!x&&Number.isInteger(x.fieldSize)&&x.fieldSize>0&&x.finishPosition!=null&&typeof x.jockey==='string'&&x.jockey.length>0&&Number.isFinite(x.assignedWeight)&&x.assignedWeight>=40&&x.assignedWeight<=70&&Number.isFinite(x.bodyWeight)&&x.bodyWeight>=250&&x.bodyWeight<=700&&/^\d+:\d{2}(?:\.\d)?$/.test(x.timeText||'')}
