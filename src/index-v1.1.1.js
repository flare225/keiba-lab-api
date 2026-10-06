import app from "./index.js";

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

async function resolveStatusDate(db, requestedDate) {
  if (requestedDate) {
    if (!validDate(requestedDate)) throw new Error("date must be YYYY-MM-DD");
    return { date: requestedDate, fallbackToLatest: false };
  }

  const today = tokyoDate();
  const todayCount = await db
    .prepare("SELECT COUNT(*) AS count FROM jra_races WHERE race_date = ?")
    .bind(today)
    .first();

  if (Number(todayCount?.count || 0) > 0) {
    return { date: today, fallbackToLatest: false };
  }

  const latest = await db
    .prepare("SELECT MAX(race_date) AS latest_date FROM jra_races")
    .first();

  return {
    date: latest?.latest_date || today,
    fallbackToLatest: Boolean(latest?.latest_date),
  };
}

function buildGapDiagnostics(races) {
  const byVenue = new Map();
  for (const race of races) {
    if (!byVenue.has(race.venue)) byVenue.set(race.venue, []);
    byVenue.get(race.venue).push(Number(race.race_no));
  }

  const venueSummary = [];
  const missingRaces = [];

  for (const [venue, raceNos] of [...byVenue.entries()].sort((a, b) => a[0].localeCompare(b[0], "ja"))) {
    const present = [...new Set(raceNos)].filter((n) => n >= 1 && n <= 12).sort((a, b) => a - b);
    const missing = [];
    for (let raceNo = 1; raceNo <= 12; raceNo++) {
      if (!present.includes(raceNo)) {
        missing.push(raceNo);
        missingRaces.push({ venue, raceNo });
      }
    }
    venueSummary.push({ venue, raceCount: present.length, presentRaceNos: present, missingRaceNos: missing });
  }

  return { venueSummary, missingRaces };
}

async function statusResponse(url, env) {
  try {
    const requestedDate = url.searchParams.get("date");
    const resolved = await resolveStatusDate(env.DB, requestedDate);

    const races = await env.DB
      .prepare(
        "SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at FROM jra_races WHERE race_date=? ORDER BY venue,race_no"
      )
      .bind(resolved.date)
      .all();

    const raceRows = races.results || [];
    const runners = await env.DB
      .prepare(
        "SELECT COUNT(*) AS count FROM jra_runners WHERE race_key IN (SELECT race_key FROM jra_races WHERE race_date=?)"
      )
      .bind(resolved.date)
      .first();

    const diagnostics = buildGapDiagnostics(raceRows);

    return json({
      ok: true,
      stage: "full-day-d1-status",
      version: "1.1.3",
      requestedDate: requestedDate || tokyoDate(),
      date: resolved.date,
      fallbackToLatest: resolved.fallbackToLatest,
      raceCount: raceRows.length,
      runnerCount: Number(runners?.count || 0),
      ...diagnostics,
      races: raceRows,
    });
  } catch (error) {
    return json({ ok: false, version: "1.1.3", error: String(error) }, 400);
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "keiba-lab/1.1.3 (+missing-race repair)",
      accept: "text/html,*/*;q=0.8",
    },
    redirect: "follow",
  });
  const buffer = await response.arrayBuffer();
  let body;
  try {
    body = new TextDecoder("shift_jis").decode(buffer);
  } catch {
    body = new TextDecoder("utf-8").decode(buffer);
  }
  return { ok: response.ok, status: response.status, url: response.url, body };
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

function cleanName(value) {
  return text(value).replace(/^\d+\s*/, "").trim();
}

const BAD = new Set([
  "ニュース", "企業情報", "社会貢献活動", "レース情報", "新規会員登録", "ホーム",
  "競馬メニュー", "レース成績データ", "重賞レース一覧", "スマートフォン", "サイトマップ",
  "リンク", "ご利用に際して", "ウェブアクセシビリティについて", "成績データ",
]);

function plausibleHorseName(name) {
  return name.length >= 2 && name.length <= 18 && /^[ァ-ヶー・ヴヷヸヹヺ]+$/.test(name) && !BAD.has(name);
}

function cellBlocks(row) {
  return [...row.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((m) => ({
    html: m[1],
    text: text(m[1]),
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
      if (!profileCell && /(牡|牝|せん)\s*[2-9]/.test(cell.text) && /(4[89]|5[0-9]|6[0-2])(?:\.\d)?\s*(?:kg|キロ)/i.test(cell.text)) {
        profileCell = cell;
      }
    }
    if (!horseCell || !profileCell) continue;

    const horseAnchors = anchorTexts(horseCell.html);
    const name = horseAnchors.find(plausibleHorseName) || null;
    if (!name || seen.has(name)) continue;

    let trainer = null;
    for (const value of horseAnchors) {
      if (value !== name && /[一-龠々]/.test(value)) {
        trainer = value;
        break;
      }
    }

    const profileAnchors = anchorTexts(profileCell.html).filter((v) => v !== name && !plausibleHorseName(v));
    const allAnchors = anchorTexts(row);
    const jockey = profileAnchors[0] || allAnchors.find((v) => v !== name && v !== trainer && /[一-龠々]/.test(v) && v.length <= 12) || null;

    const numberCells = cells.map((c) => c.text).filter((v) => /^(?:[1-9]|1[0-8])$/.test(v)).map(Number);
    const horseNo = numberCells.length ? numberCells[numberCells.length - 1] : null;

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
    if (/ステークス|賞|特別|未勝利|新馬|クラス|オープン|ジャンプ|カップ|王冠|大賞典/.test(value)) return value;
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
    /コース[：:]\s*([123][0-9,，]{3,4})\s*(?:m|メートル)?[^。\n]{0,40}[（(]?\s*(芝|ダート|障害)/i,
    /コース[：:][^。\n]{0,80}(芝|ダート|障害)[^0-9]{0,30}([123][0-9,，]{3,4})/i,
    /(芝|ダート|障害)\s*([123][0-9,，]{3,4})\s*(?:m|メートル)?/i,
    /([123][0-9,，]{3,4})\s*(?:m|メートル)?\s*(芝|ダート|障害)/i,
  ];
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (!match) continue;
    const first = String(match[1] || "").replace(/[,，]/g, "");
    const second = String(match[2] || "").replace(/[,，]/g, "");
    if (/^\d/.test(first)) return { surface: match[2] || null, distance: Number(first) || null };
    return { surface: match[1] || null, distance: Number(second) || null };
  }
  return { surface: null, distance: null };
}

function deriveRaceUrl(templateUrl, raceNo) {
  const url = new URL(templateUrl);
  const cname = url.searchParams.get("CNAME") || "";
  const match = cname.match(/^(pw01dde01\d{2}\d{4}\d{2}\d{2})(\d{2})(\d{8}.*)$/i);
  if (!match) return null;
  const next = `${match[1]}${String(raceNo).padStart(2, "0")}${match[3]}`;
  url.searchParams.set("CNAME", next);
  return url.href;
}

function parseRepairPage(page, date, venue, raceNo) {
  const allText = text(page.body);
  const raceName = findRaceName(page.body);
  const course = courseFromContext(allText, raceName);
  const rawRunners = extractRunners(page.body);
  const runners = rawRunners.map((runner) => ({
    ...runner,
    frameNo: deriveFrameNo(runner.horseNo, rawRunners.length),
  }));
  return {
    raceDate: date,
    venue,
    raceNo,
    raceName,
    surface: course.surface,
    distance: course.distance,
    sourceUrl: page.url,
    runnerCount: runners.length,
    runners,
  };
}

async function repairMissingRaces(db, date) {
  if (!validDate(date)) throw new Error("date must be YYYY-MM-DD");

  const raceResult = await db
    .prepare("SELECT race_key,race_date,venue,race_no,source_url FROM jra_races WHERE race_date=? ORDER BY venue,race_no")
    .bind(date)
    .all();
  const rows = raceResult.results || [];
  const diagnostics = buildGapDiagnostics(rows);

  if (!diagnostics.missingRaces.length) {
    return { ok: true, stage: "missing-races-repaired", version: "1.1.3", date, attempted: 0, repaired: 0, failed: 0, results: [] };
  }

  const results = [];
  let repaired = 0;

  for (const missing of diagnostics.missingRaces) {
    const template = rows.find((row) => row.venue === missing.venue && row.source_url);
    if (!template) {
      results.push({ ...missing, status: "failed", reason: "no sibling source_url" });
      continue;
    }

    const targetUrl = deriveRaceUrl(template.source_url, missing.raceNo);
    if (!targetUrl) {
      results.push({ ...missing, status: "failed", reason: "could not derive JRADB URL" });
      continue;
    }

    try {
      const page = await fetchHtml(targetUrl);
      if (!page.ok) {
        results.push({ ...missing, status: "failed", reason: `HTTP ${page.status}`, targetUrl });
        continue;
      }

      const race = parseRepairPage(page, date, missing.venue, missing.raceNo);
      if (!race.runnerCount || race.runners.some((runner) => !runner.horseNo || !runner.name)) {
        results.push({ ...missing, status: "failed", reason: "runner parse validation failed", targetUrl, runnerCount: race.runnerCount });
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
    ok: repaired === diagnostics.missingRaces.length,
    stage: "missing-races-repaired",
    version: "1.1.3",
    date,
    attempted: diagnostics.missingRaces.length,
    repaired,
    failed: diagnostics.missingRaces.length - repaired,
    results,
  };
}

async function refreshExistingRaceMetadata(db, date, venue, raceNo) {
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) throw new Error("date, venue, race_no required");
  const existing = await db.prepare("SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at FROM jra_races WHERE race_date=? AND venue=? AND race_no=?").bind(date, venue, raceNo).first();
  if (!existing?.source_url) throw new Error("existing race/source_url not found");
  const page = await fetchHtml(existing.source_url);
  if (!page.ok) throw new Error(`race page HTTP ${page.status}`);
  const parsed = parseRepairPage(page, date, venue, raceNo);
  if (!parsed.raceName || !parsed.surface || !Number.isFinite(Number(parsed.distance)) || Number(parsed.distance) < 1000 || Number(parsed.distance) > 4000) throw new Error("official course metadata parse validation failed");
  if (parsed.runnerCount && Number(existing.runner_count) && parsed.runnerCount !== Number(existing.runner_count)) throw new Error("runner-count drift; metadata refresh refused");
  const fetchedAt = new Date().toISOString();
  await db.prepare("UPDATE jra_races SET race_name=?,surface=?,distance=?,source_url=?,fetched_at=? WHERE race_key=?").bind(parsed.raceName, parsed.surface, Number(parsed.distance), page.url, fetchedAt, existing.race_key).run();
  return {ok:true,stage:"race-metadata-refreshed",version:"1.1.4",raceKey:existing.race_key,before:{raceName:existing.race_name,surface:existing.surface,distance:Number(existing.distance||0),fetchedAt:existing.fetched_at},after:{raceName:parsed.raceName,surface:parsed.surface,distance:Number(parsed.distance),fetchedAt},guardrails:{runnerRowsMutated:false,resultFieldsRead:false,sourceUrl:page.url}};
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.1.3",
        phase: "date-aware status + missing-race repair",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/jra/status") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      return statusResponse(url, env);
    }

    if (url.pathname === "/v1/jra/refresh-race") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        const date = url.searchParams.get("date");
        const venue = url.searchParams.get("venue");
        const raceNo = Number(url.searchParams.get("race_no"));
        return json(await refreshExistingRaceMetadata(env.DB, date, venue, raceNo));
      } catch (error) {
        return json({ ok: false, version: "1.1.4", error: String(error) }, 400);
      }
    }

    if (url.pathname === "/v1/jra/repair") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        const date = url.searchParams.get("date") || tokyoDate();
        const result = await repairMissingRaces(env.DB, date);
        return json(result, result.ok ? 200 : 502);
      } catch (error) {
        return json({ ok: false, version: "1.1.3", error: String(error) }, 400);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
