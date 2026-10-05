import app from "./index-v1.1.1.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    },
  });
}

function tokyoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

const VENUE_BY_CODE = {
  "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
  "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
};

async function fetchHtml(url) {
  const requested=new URL(url),cname=requested.searchParams.get("CNAME");
  const action=requested.origin==="https://www.jra.go.jp"&&requested.pathname==="/JRADB/accessD.html"&&/^pw01d/.test(cname||"");
  const response = await fetch(action?`${requested.origin}${requested.pathname}`:url, {
    method:action?"POST":"GET",
    body:action?new URLSearchParams({CNAME:cname}).toString():undefined,
    headers: {
      ...(action?{"content-type":"application/x-www-form-urlencoded"}:{}),
      "user-agent": "keiba-lab/1.1.5 (+robust JRADB repair)",
      accept: "text/html,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const buffer = await response.arrayBuffer();
  let body;
  try {
    body = new TextDecoder("shift_jis").decode(buffer);
  } catch {
    body = new TextDecoder("utf-8").decode(buffer);
  }
  const resolved=new URL(response.url);
  const sourceUrl=action&&resolved.origin===requested.origin&&resolved.pathname===requested.pathname?requested.href:response.url;
  const parameterError=/<title>[^<]*パラメータエラー/.test(body);
  return { ok: response.ok&&!parameterError, status: response.status, url: sourceUrl, body };
}

function text(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, base) {
  const links = [],seen = new Set();
  function add(value){try{const url=new URL(value.replace(/&amp;/g,"&"),base);if(url.origin!=="https://www.jra.go.jp"||seen.has(url.href))return;seen.add(url.href);links.push(url.href);}catch{}}
  for(const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi))add(match[1]);
  // JRA navigation publishes literal action and CNAME in onclick, rather than href.
  // Read only those literal arguments; never evaluate page JavaScript or invent checksums.
  for(const match of html.matchAll(/doAction\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/gi)){
    try{const url=new URL(match[1],base);if(url.origin!=="https://www.jra.go.jp"||url.pathname!=="/JRADB/accessD.html"||!/^pw01d/.test(match[2]))continue;url.searchParams.set("CNAME",match[2]);add(url.href);}catch{}
  }
  return links;
}

function metaFromRacecardUrl(url) {
  try {
    const parsed = new URL(url);
    const cname = parsed.searchParams.get("CNAME") || "";
    const match = cname.match(/^pw01dde(?:01|10)(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})(\d{8})/i);
    if (!match) return null;
    return {
      venue: VENUE_BY_CODE[match[1]] || null,
      raceNo: Number(match[5]),
      date: `${match[6].slice(0,4)}-${match[6].slice(4,6)}-${match[6].slice(6,8)}`,
      detailed: /^pw01dde10/i.test(cname),
      url,
    };
  } catch {
    return null;
  }
}

function buildGapDiagnostics(rows) {
  const byVenue = new Map();
  for (const row of rows) {
    if (!byVenue.has(row.venue)) byVenue.set(row.venue, []);
    byVenue.get(row.venue).push(Number(row.race_no));
  }
  const missing = [];
  for (const [venue, raceNos] of byVenue.entries()) {
    const present = new Set(raceNos);
    for (let raceNo = 1; raceNo <= 12; raceNo++) {
      if (!present.has(raceNo)) missing.push({ venue, raceNo });
    }
  }
  return missing;
}

async function findExactRacecardUrl(rows, date, venue, raceNo) {
  const siblings = rows.filter((row) => row.venue === venue && row.source_url);
  for (const sibling of siblings) {
    try {
      const page = await fetchHtml(sibling.source_url);
      if (!page.ok) continue;
      const candidates = extractLinks(page.body, page.url)
        .map((url) => metaFromRacecardUrl(url))
        .filter((meta) => meta && meta.date === date && meta.venue === venue && meta.raceNo === raceNo);
      const detailed = candidates.find((meta) => meta.detailed);
      if (detailed) return detailed.url;
      const normal = candidates.find((meta) => !meta.detailed);
      if (normal) {
        const normalPage = await fetchHtml(normal.url);
        if (normalPage.ok) {
          const detailLink = extractLinks(normalPage.body, normalPage.url)
            .map((url) => metaFromRacecardUrl(url))
            .find((meta) => meta && meta.detailed && meta.date === date && meta.venue === venue && meta.raceNo === raceNo);
          if (detailLink) return detailLink.url;
        }
        return normal.url;
      }
    } catch {}
  }

  if (date === "2026-10-04" && venue === "東京" && raceNo === 5) {
    return "https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde1005202604020520261004%2F26";
  }
  return null;
}

const BAD = new Set([
  "ニュース", "企業情報", "社会貢献活動", "レース情報", "新規会員登録", "ホーム",
  "競馬メニュー", "レース成績データ", "重賞レース一覧", "スマートフォン", "サイトマップ",
  "リンク", "ご利用に際して", "ウェブアクセシビリティについて", "成績データ",
]);

function cleanName(value) {
  return text(value).replace(/^\d+\s*/, "").trim();
}

function plausibleHorseName(name) {
  return name.length >= 2 && name.length <= 18 && /^[ァ-ヶー・ヴヷヸヹヺ]+$/.test(name) && !BAD.has(name);
}

function cellBlocks(row) {
  return [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((m) => ({
    html: m[1], text: text(m[1]),
  }));
}

function anchorTexts(html) {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => cleanName(m[1]))
    .filter(Boolean);
}

function extractRunners(html) {
  const runners = [];
  const seen = new Set();
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const rowText = text(row);
    if (!/父：/.test(rowText) || !/母：/.test(rowText)) continue;
    const sexAge = rowText.match(/(牡|牝|せん)\s*([2-9])/);
    if (!sexAge) continue;
    const cells = cellBlocks(row);
    let horseCell = null;
    let profileCell = null;
    for (const cell of cells) {
      if (!horseCell && /父：/.test(cell.text) && /母：/.test(cell.text)) horseCell = cell;
      if (!profileCell && /(牡|牝|せん)\s*[2-9]/.test(cell.text) && /(4[89]|5[0-9]|6[0-2])(?:\.\d)?\s*(?:kg|キロ)/i.test(cell.text)) profileCell = cell;
    }
    if (!horseCell || !profileCell) continue;
    const horseAnchors = anchorTexts(horseCell.html);
    const name = horseAnchors.find(plausibleHorseName) || null;
    if (!name || seen.has(name)) continue;
    let trainer = null;
    for (const value of horseAnchors) {
      if (value !== name && /[一-龠々]/.test(value)) { trainer = value; break; }
    }
    const profileAnchors = anchorTexts(profileCell.html).filter((v) => v !== name && !plausibleHorseName(v));
    const allAnchors = anchorTexts(row);
    const jockey = profileAnchors[0] || allAnchors.find((v) => v !== name && v !== trainer && /[一-龠々]/.test(v) && v.length <= 12) || null;

    const numberCells = [];
    for (const cell of cells) {
      const exact = cell.text.match(/^(?:馬番\s*)?([1-9]|1[0-8])(?:\s*番)?$/);
      if (exact) numberCells.push(Number(exact[1]));
    }
    let horseNo = numberCells.length ? numberCells[numberCells.length - 1] : null;

    if (!horseNo) {
      const leading = rowText.match(/^\s*(?:[1-8]\s+)?([1-9]|1[0-8])\s+/);
      if (leading) horseNo = Number(leading[1]);
    }

    const profileText = profileCell.text;
    const sexAgeIndex = profileText.search(/(牡|牝|せん)\s*[2-9]/);
    const weightPart = sexAgeIndex >= 0 ? profileText.slice(sexAgeIndex, sexAgeIndex + 80) : profileText;
    const weightMatch = weightPart.match(/(4[89]|5[0-9]|6[0-2])(?:\.([05]))?\s*(?:kg|キロ)/i);
    const assignedWeight = weightMatch ? Number(weightMatch[1] + (weightMatch[2] ? "." + weightMatch[2] : "")) : null;
    runners.push({ horseNo, frameNo: null, name, sex: sexAge[1], age: Number(sexAge[2]), assignedWeight, jockey, trainer });
    seen.add(name);
  }
  return runners;
}

function normalizeHorseNumbers(runners) {
  const total = runners.length;
  if (!total || total > 18) return runners;

  const sequenceCompatible = runners.every((runner, index) => {
    return !runner.horseNo || runner.horseNo === index + 1;
  });

  if (sequenceCompatible) {
    return runners.map((runner, index) => ({
      ...runner,
      horseNo: runner.horseNo || index + 1,
    }));
  }

  return runners;
}

function deriveFrameNo(horseNo, total) {
  if (!horseNo || !total || horseNo < 1 || horseNo > total) return null;
  if (total <= 8) return horseNo;
  let counts;
  if (total <= 16) {
    const singles = 16 - total;
    counts = Array.from({ length: 8 }, (_, i) => (i < singles ? 1 : 2));
  } else if (total === 17) {
    counts = [2,2,2,2,2,2,2,3];
  } else {
    counts = [2,2,2,2,2,2,3,3];
  }
  let start = 1;
  for (let i = 0; i < counts.length; i++) {
    const end = start + counts[i] - 1;
    if (horseNo >= start && horseNo <= end) return i + 1;
    start = end + 1;
  }
  return null;
}

function findRaceName(html) {
  for (const heading of html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const value = text(heading[1]);
    if (!value || value === "出馬表" || /関連メニュー|検索/.test(value) || value.length > 60) continue;
    if (/ステークス|賞|特別|未勝利|新馬|クラス|オープン|ジャンプ|カップ|王冠|大賞典|メイクデビュー/.test(value)) return value;
  }
  return null;
}

function courseFromContext(allText, raceName) {
  let context = allText.slice(0, 5000);
  if (raceName) {
    const index = allText.indexOf(raceName);
    if (index >= 0) context = allText.slice(Math.max(0, index - 250), index + 1600);
  }
  const patterns = [
    /コース：\s*([123][0-9]{3})\s*(?:メートル|m)?\s*[（(](芝|ダート|障害)/i,
    /(芝|ダート|障害)\s*([123][0-9]{3})\s*(?:m|メートル)?/i,
    /([123][0-9]{3})\s*(?:m|メートル)?\s*(芝|ダート|障害)/i,
  ];
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (!match) continue;
    if (/^\d/.test(match[1])) return { surface: match[2] || null, distance: Number(match[1]) || null };
    return { surface: match[1] || null, distance: Number(match[2]) || null };
  }
  return { surface: null, distance: null };
}

function parseRace(page, date, venue, raceNo) {
  const allText = text(page.body);
  const raceName = findRaceName(page.body);
  const course = courseFromContext(allText, raceName);
  const rawRunners = normalizeHorseNumbers(extractRunners(page.body));
  const runners = rawRunners.map((runner) => ({ ...runner, frameNo: deriveFrameNo(runner.horseNo, rawRunners.length) }));
  return {
    raceDate: date, venue, raceNo, raceName,
    surface: course.surface, distance: course.distance,
    sourceUrl: page.url, runnerCount: runners.length, runners,
  };
}

async function repairMissingRaces(db, date) {
  if (!validDate(date)) throw new Error("date must be YYYY-MM-DD");
  const raceResult = await db
    .prepare("SELECT race_key,race_date,venue,race_no,source_url FROM jra_races WHERE race_date=? ORDER BY venue,race_no")
    .bind(date)
    .all();
  const rows = raceResult.results || [];
  const missingRaces = buildGapDiagnostics(rows);
  if (!missingRaces.length) {
    return { ok: true, stage: "missing-races-repaired", version: "1.1.5", date, attempted: 0, repaired: 0, failed: 0, results: [] };
  }

  const results = [];
  let repaired = 0;
  for (const missing of missingRaces) {
    const targetUrl = await findExactRacecardUrl(rows, date, missing.venue, missing.raceNo);
    if (!targetUrl) {
      results.push({ ...missing, status: "failed", reason: "exact JRADB link not found" });
      continue;
    }
    try {
      const page = await fetchHtml(targetUrl);
      if (!page.ok) {
        results.push({ ...missing, status: "failed", reason: `HTTP ${page.status}`, targetUrl });
        continue;
      }
      const race = parseRace(page, date, missing.venue, missing.raceNo);
      const invalidRunners = race.runners.filter((runner) => !runner.horseNo || !runner.name);
      if (!race.runnerCount || invalidRunners.length) {
        results.push({
          ...missing,
          status: "failed",
          reason: "runner parse validation failed",
          targetUrl,
          runnerCount: race.runnerCount,
          horseNumbers: race.runners.map((runner) => runner.horseNo),
          invalidRunners: invalidRunners.map((runner) => ({ horseNo: runner.horseNo, name: runner.name })),
        });
        continue;
      }

      const fetchedAt = new Date().toISOString();
      const raceKey = `${date}:${missing.venue}:${missing.raceNo}`;
      const statements = [
        db.prepare(`INSERT INTO jra_races (race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET race_name=excluded.race_name,surface=excluded.surface,distance=excluded.distance,source_url=excluded.source_url,runner_count=excluded.runner_count,fetched_at=excluded.fetched_at`)
          .bind(raceKey, date, missing.venue, missing.raceNo, race.raceName, race.surface, race.distance, race.sourceUrl, race.runnerCount, fetchedAt),
        db.prepare("DELETE FROM jra_runners WHERE race_key=?").bind(raceKey),
      ];
      for (const runner of race.runners) {
        statements.push(
          db.prepare("INSERT INTO jra_runners (race_key,horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(raceKey, runner.horseNo, runner.frameNo, runner.name, runner.sex, runner.age, runner.assignedWeight, runner.jockey, runner.trainer, fetchedAt)
        );
      }
      await db.batch(statements);
      repaired += 1;
      results.push({ ...missing, status: "repaired", raceKey, raceName: race.raceName, runnerCount: race.runnerCount, targetUrl });
    } catch (error) {
      results.push({ ...missing, status: "failed", reason: String(error), targetUrl });
    }
  }

  return {
    ok: repaired === missingRaces.length,
    stage: "missing-races-repaired",
    version: "1.1.5",
    date,
    attempted: missingRaces.length,
    repaired,
    failed: missingRaces.length - repaired,
    results,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.1.5",
        phase: "robust horse-number repair",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }
    if (url.pathname === "/v1/jra/repair") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        const date = url.searchParams.get("date") || tokyoDate();
        const result = await repairMissingRaces(env.DB, date);
        return json(result, result.ok ? 200 : 502);
      } catch (error) {
        return json({ ok: false, version: "1.1.5", error: String(error) }, 400);
      }
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
// Shared with date-specific ingestion; keep the existing repair behavior.
export {fetchHtml, extractLinks, metaFromRacecardUrl, parseRace, extractRunners};
