// Public special-registration name/age facts observed 2026-10-20.
// These are not confirmed runners and carry no frame or horse numbers.
const cards=[
 {raceNo:9,raceName:'柏崎特別',raceId:'202604040409',ages:{'アスクヴォルテージ':4,'アドマイヤウルトラ':3,'カザンラク':4,'クイーンズワーフ':5,'クモヒトツナイ':4,'ケールハイム':3,'コウギョク':3,'ゴールドブレス':5,'サンデースマッシュ':3,'ジェゼロ':4,'シャルムグリーン':3,'ジャンヌローサ':5,'シャンパンライフ':4,'ジュナベーラ':3,'ジーティーシンドウ':3,'タイセイアストロ':3,'ダノンブランニュー':4,'デビューフライト':4,'テルヴィセクス':3,'ハクサンミレイ':3,'リアライズブラーヴ':3,'リネンタイリン':3,'ルージュリリック':3}},
 {raceNo:10,raceName:'村上特別',raceId:'202604040410',ages:{'ウインリベラシオン':4,'コンフォルツァ':4,'ジェットブレード':4,'ジャンビ':5,'シルバーリム':3,'ズイウンゴサイ':5,'スタニングヴュー':4,'ハートメテオ':4,'フォルテフィオーレ':5,'フルレゾン':5,'ベネスピラ':4,'マイネルアズーロ':4,'マイネルマスター':3,'ロゼル':6}}
];
export const NIIGATA_ADDITIONAL_ROSTER_SEEDS=cards.map(c=>({snapshotId:'netkeiba-niigata-'+c.raceNo+'-registration-reviewed-20261020-v1',record:{date:'2026-10-25',venue:'新潟',raceNo:c.raceNo,raceName:c.raceName,provider:'netkeiba',kind:'special-registration',sourceUrl:'https://race.netkeiba.com/race/shutuba_past.html?race_id='+c.raceId,observedAt:'2026-10-20T01:03:00Z',sourceText:'2026年10月25日 新潟'+c.raceNo+'R '+c.raceName+' 特別登録'+Object.keys(c.ages).length+'頭。枠順・馬番未確定。公開表の馬名と年齢。\n'+Object.entries(c.ages).map(([n,a])=>n+' '+a+'歳').join('\n'),runners:Object.entries(c.ages).map(([horseName,age])=>({horseName,age}))}}));
