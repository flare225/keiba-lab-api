import {saveExpectedRoster} from './expected-roster-registry.js';
// Only source-reviewed records committed with the application may be imported
// without an owner write token. Request payloads never supply names or evidence.
export const EXPECTED_ROSTER_SEEDS=[
  {
    "snapshotId": "jra-kikka-registration-20261012-reviewed-20261019-v1",
    "record": {
      "date": "2026-10-25",
      "venue": "京都",
      "raceNo": 11,
      "raceName": "菊花賞",
      "provider": "JRA",
      "kind": "special-registration",
      "sourceUrl": "https://www.jra.go.jp/keiba/tokubetsu/pdf/2026/kikka.pdf",
      "observedAt": "2026-10-19T08:10:27.981155Z",
      "sourceText": "JRA 出走馬決定順一覧（特別登録） 2026/10/12 P.0001\n2026年 第4回京都第9日 第11競走 菊花賞(GI) 芝3000m\n登録21頭 出走可能頭数18頭\nPDF目視転記。登録一覧であり正式出走馬・枠番・馬番ではない。\nPDF SHA256 b6fa9f19cecf57e01af0486e9b2c22735c414ba8331fecae18aec25e15cdbc61\nアウダーシア 牡3歳 負担重量57kg\nアルトラムス 牡3歳 負担重量57kg\nジャスティンシカゴ 牡3歳 負担重量57kg\nシートゥサミット 牡3歳 負担重量57kg\nロブチェン 牡3歳 負担重量57kg\nコンジェスタス 牡3歳 負担重量57kg\nゴーイントゥスカイ 牡3歳 負担重量57kg\nバステール 牡3歳 負担重量57kg\nサノノグレーター 牡3歳 負担重量57kg\nアスクエジンバラ 牡3歳 負担重量57kg\nショウナンガルフ 牡3歳 負担重量57kg\nショウナンハヤナミ 牡3歳 負担重量57kg\nラージアンサンブル 牡3歳 負担重量57kg\nキンググローリー 牡3歳 負担重量57kg\nダノンヒストリー 牡3歳 負担重量57kg\nチャリングクロス 牡3歳 負担重量57kg\nナリタエスペランサ 牡3歳 負担重量57kg\nマジョレルブルー 牡3歳 負担重量57kg\nエムズビギン 牡3歳 負担重量57kg\nイブキ 牡3歳 負担重量57kg\nミッキーファルコン 牡3歳 負担重量57kg",
      "runners": [
        {
          "horseName": "アウダーシア",
          "age": 3
        },
        {
          "horseName": "アルトラムス",
          "age": 3
        },
        {
          "horseName": "ジャスティンシカゴ",
          "age": 3
        },
        {
          "horseName": "シートゥサミット",
          "age": 3
        },
        {
          "horseName": "ロブチェン",
          "age": 3
        },
        {
          "horseName": "コンジェスタス",
          "age": 3
        },
        {
          "horseName": "ゴーイントゥスカイ",
          "age": 3
        },
        {
          "horseName": "バステール",
          "age": 3
        },
        {
          "horseName": "サノノグレーター",
          "age": 3
        },
        {
          "horseName": "アスクエジンバラ",
          "age": 3
        },
        {
          "horseName": "ショウナンガルフ",
          "age": 3
        },
        {
          "horseName": "ショウナンハヤナミ",
          "age": 3
        },
        {
          "horseName": "ラージアンサンブル",
          "age": 3
        },
        {
          "horseName": "キンググローリー",
          "age": 3
        },
        {
          "horseName": "ダノンヒストリー",
          "age": 3
        },
        {
          "horseName": "チャリングクロス",
          "age": 3
        },
        {
          "horseName": "ナリタエスペランサ",
          "age": 3
        },
        {
          "horseName": "マジョレルブルー",
          "age": 3
        },
        {
          "horseName": "エムズビギン",
          "age": 3
        },
        {
          "horseName": "イブキ",
          "age": 3
        },
        {
          "horseName": "ミッキーファルコン",
          "age": 3
        }
      ]
    }
  }
];
export async function importExpectedRosterSeed(db,snapshotId,stamp=Date.now(),seeds=EXPECTED_ROSTER_SEEDS){
 if(typeof snapshotId!=='string'||!snapshotId||snapshotId.length>150)throw Error('公開コードに登録した名簿IDが必要です。');
 const seed=seeds.find(s=>s.snapshotId===snapshotId);
 if(!seed) return{ok:true,status:'source-reviewed-seed-not-available',storedRunners:0,externalRequests:0};
 return{...await saveExpectedRoster(db,seed.record,stamp),status:'source-reviewed-roster-imported'};
}
