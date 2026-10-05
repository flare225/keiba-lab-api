const clean=v=>String(v??'').replace(/\r/g,'').trim();
export function composePredictionNote({race={},prediction={},decisionLab={},readiness={}}={}){
 const title=`${race.date||''} ${race.venue||''}${race.raceNo||''}R ${race.raceName||''}`.trim();
 const lines=[`🏇 ${title}`,'','【KEIBA LABO 事前予想】'];
 if(prediction.available){lines.push('🔒 発走前LOCK済み');for(const x of prediction.top5||[])lines.push(`${x.mark||''} ${x.horseNo||''} ${clean(x.horseName)}${x.score==null?'':`（LABO ${x.score}pt）`}`)}else lines.push('LABO事前予想：LOCK前');
 lines.push('','【展望・チェック】');
 const ce=decisionLab.counterevidence||[],miss=decisionLab.missedHorses||[];
 lines.push(ce.length?`⚠️ 反証 ${ce.length}件`:'⚠️ 反証：現時点なし');
 for(const x of ce.slice(0,5))lines.push(`・${clean(x.horseName||x.label||x.reason||'反証あり')}${x.reason?`：${clean(x.reason)}`:''}`);
 lines.push(miss.length?`👀 見逃し候補 ${miss.length}頭`:'👀 見逃し候補：現時点なし');
 for(const x of miss.slice(0,5))lines.push(`・${clean(x.horseName||x.label||'候補')}`);
 lines.push('','【実戦パイプライン】',`出馬表：${readiness.cardComplete?'✓ 保存完了':'○ 待機'}`,`LABO LOCK：${prediction.available?'✓':'○'}`,`哲平印：${readiness.userRevision?'✓ 保存済み':'○ 未入力'}`,`DB再精査：${decisionLab.available?'✓ 稼働':'○ 待機'}`,'','※この記事は発走前に保存された情報を基準に作成。結果から事前予想を書き換えません。');
 return lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function composeReviewNote({race={},prediction={},result={},review=[]}={}){
 const title=`${race.date||''} ${race.venue||''}${race.raceNo||''}R ${race.raceName||''}`.trim();const lines=[`🏁 ${title} 回顧`,'','【事前LABO印】'];
 if(prediction.available)for(const x of prediction.top5||[])lines.push(`${x.mark||''} ${x.horseNo||''} ${clean(x.horseName)}`);else lines.push('発走前LABO予想記録なし');
 lines.push('','【結果】');for(const x of result.runners||[])lines.push(`${x.finishPosition||'—'}着 ${x.horseNo||''} ${clean(x.horseName)}`);
 lines.push('','【振り返り】');if(review.length)for(const x of review)lines.push(`・${clean(x)}`);else lines.push('回顧メモ未入力');
 lines.push('','※事前予想と結果を分離して保存し、後付けで事前印を変更しません。');return lines.join('\n').trim();
}
