import {expectedPreviewPage} from './expected-preview-page-v3.31.0.js';
import {EXPECTED_SOURCES} from './expected-runner-preview-v3.30.0.js';
export function comparisonPage(source=EXPECTED_SOURCES[0]){
 let page=expectedPreviewPage(source).replace(/<script>[\s\S]*?<\/script>/,'');
 page=page.replace('KEIBA LABO 想定馬の仮比較','KEIBA LABO 初期印とDBの仮評価').replace('出走馬 × 初期印の精査','初期印 × DBの仮評価').replace('初期印を過去DBから精査','DBを読み直して比較').replace('印を付けて仮比較を実行してください。','初期印を付けると、DBの仮評価が自動で表示されます。');
 page=page.replace('<div class="actions">','<p id="localMarkNote" class="meta">初期印はこのブラウザ内に保存。DBへの印保存ではありません。</p><div class="actions">');
 page=page.replace('<div id="results" aria-live="polite"></div>','<div id="comparisonSummary" class="card" aria-live="polite"></div><p id="baselineNote" class="meta"></p><div id="results" aria-live="polite"></div><section id="allRunnerTable"></section>');
 page=page.replace('</style>','.reason-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.metric small{display:block;color:var(--muted)}h3{font-size:15px;margin:18px 0 8px}.gaps{color:var(--muted);padding-left:22px}.gaps li{margin:6px 0}.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:620px}td,th{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}details{border-top:1px solid var(--line);padding-top:12px}summary{cursor:pointer;color:var(--accent)}#comparisonSummary:empty{display:none}@media(max-width:540px){.reason-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.horsehead{align-items:flex-start;font-size:16px}} </style>');
 const target=JSON.stringify({date:source.date,venue:source.venue,raceNo:source.raceNo,snapshotId:source.snapshotId,names:source.names}).replace(/</g,'\\u003c');
 return page.replace('</body>','<script type="application/json" id="comparisonTarget">'+target+'</script><script type="module" src="/lab/mark-comparison-client.js"></script></body>');
}
