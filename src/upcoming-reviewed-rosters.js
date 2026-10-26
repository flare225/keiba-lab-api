// Public facts reviewed on 2026-10-26. This is a selected candidate list,
// not the complete special registration, confirmed entries, or a formal card.
const runners=[['クロワデュノール',4],['マスカレードボール',4],['ダノンデサイル',5],['レガレイラ',5],['シェイクユアハート',6],['セイウンハーデス',7],['コスモキュランダ',5],['リアライズシリウス',3],['ジョバンニ',4],['ホウオウビスケッツ',6]].map(([horseName,age])=>({horseName,age}));
export const UPCOMING_REVIEWED_ROSTERS=[{
 naturalPreparation:true,
 snapshotId:'jra-featured-candidates-20261101-tokyo11-reviewed-20261026-v1',
 record:{date:'2026-11-01',venue:'東京',raceNo:11,raceName:'天皇賞（秋）',provider:'JRA',kind:'expected-runners',sourceUrl:'https://www.jra.go.jp/keiba/g1/akiten/horse.html',officialHorsePage:'https://www.jra.go.jp/keiba/g1/akiten/horse.html',observedAt:'2026-10-26T07:05:55.000Z',
 sourceText:'JRA 2026年11月1日 東京 天皇賞（秋）出走馬情報。2026-10-26に馬名・年齢を照合した選抜紹介10頭。全登録馬を網羅する名簿ではなく、出走未確定。記事の意見・能力評価・過去成績の説明は採点入力へ転記しない。馬番・枠番・騎手・斤量は未確定。元HTMLは保存しておらず、この照合記録のSHAは元HTMLのSHAではない。\n'+runners.map(r=>r.horseName+' '+r.age+'歳').join('\n'),runners}
}];
