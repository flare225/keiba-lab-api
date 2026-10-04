import app from "./index-v1.3.2.js";

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

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
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

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "keiba-lab/1.3.3 (+official JRA past performances)",
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

function rowCells(rowHtml) {
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((m) => text(m[1]));
}

function parseJapaneseDate(value) {
  const m = String(value || "").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function parseCourse(value) {
  const m = String(value || "").replace(/\s+/g, "").match(/(芝|ダート|ダ|障害)([123][0-9]{3})/);
  if (!m) return { surface: null, distance: null };
  return {
    surface: m[1] === "ダ" ? "ダート" : m[1],
    distance: Number(m[2]),
  };
}

function numberOrNull(value) {
  const m = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function integerOrNull(value) {
  const m = String(value ?? "").match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function parseBodyWeight(value) {
  const s = String(value || "");
  const weight = s.match(/(\d{3})/);
  const change = s.match(/[（(]\s*([+-]?\d+)\s*[）)]/);
  return {
    bodyWeight: weight ? Number(weight[1]) : null,
    bodyWeightChange: change ? Number(change[1]) : null,
  };
}

function normalizeCondition(value) {
  const s = String(value || "").replace(/\s+/g, "");
  if (/不良/.test(s)) return "不良";
  if (/稍重/.test(s)) return "稍重";
  if (/重/.test(s)) return "重";
  if (/良/.test(s)) return "良";
  return s || null;
}

function extractProfileLinks(html, runnerNames, baseUrl) {
  const wanted = new Set(runnerNames);
  const found = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const anchorText = text(m[2]);
    if (!wanted.has(anchorText) || found.has(anchorText)) continue;
    try {
      const url = new URL(m[1].replace(/&amp;/g, "&"), baseUrl);
      const cname = url.searchParams.get("CNAME") || "";
      if (!/\/JRADB\/accessU\.html/i.test(url.pathname)) continue;
      if (!/^pw01dud\d{2}/i.test(cname)) continue;
      found.set(anchorText, url.href);
    } catch {}
  }
  return found;
}

function parsePastPerformances(html, horseName, profileUrl, beforeDate, limit) {
  const rows = [];

  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = rowCells(match[1]);
    if (cells.length < 14) continue;

    const raceDate = parseJapaneseDate(cells[0]);
    const course = parseCourse(cells[3]);
    if (!raceDate || !course.distance) continue;
    if (raceDate >= beforeDate) continue; // strict look-ahead leakage guard

    // Observed JRA horse-profile history structure (2026):
    // 0 date, 1 venue, 2 race name, 3 surface+distance, 4 going,
    // 5 field size, 6 horse no, 7 popularity, 8 finish,
    // 9 jockey, 10 assigned weight, 11 body weight, 12 time, 13 last 3F.
    const fieldSize = integerOrNull(cells[5]);
    const popularity = integerOrNull(cells[7]);
    const finishText = String(cells[8] || "").trim();
    const finishPosition = /^\d+$/.test(finishText) ? Number(finishText) : null;
    const assignedWeight = numberOrNull(cells[10]);
    const body = parseBodyWeight(cells[11]);
    const last3f = numberOrNull(cells[13]);

    rows.push({
      horseName,
      raceDate,
      venue: cells[1] || null,
      raceName: cells[2] || null,
      surface: course.surface,
      distance: course.distance,
      finishPosition,
      fieldSize,
      popularity,
      odds: null,
      jockey: cells[9] || null,
      assignedWeight,
      bodyWeight: body.bodyWeight,
      bodyWeightChange: body.bodyWeightChange,
      timeText: cells[12] || null,
      last3f,
      cornerPositions: null,
      trackCondition: normalizeCondition(cells[4]),
      sourceUrl: profileUrl,
    });
  }

  rows.sort((a, b) => b.raceDate.localeCompare(a.raceDate));

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.raceDate}|${row.venue}|${row.raceName}|${row.distance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped.slice(0, limit);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function ensureHistoryTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS jra_past_performances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horse_name TEXT NOT NULL,
    race_date TEXT NOT NULL,
    venue TEXT,
    race_name TEXT,
    surface TEXT,
    distance INTEGER,
    finish_position INTEGER,
    field_size INTEGER,
    popularity INTEGER,
    odds REAL,
    jockey TEXT,
    assigned_weight REAL,
    body_weight INTEGER,
    body_weight_change INTEGER,
    time_text TEXT,
    last3f REAL,
    corner_positions TEXT,
    track_condition TEXT,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(horse_name, race_date, venue, race_name)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_jra_past_perf_horse_date ON jra_past_performances(horse_name, race_date DESC)").run();
}

async function resolveRace(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=1-12 are required");
  }

  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");
  if (!race.source_url) throw new Error("race source_url is missing");

  const rr = await db.prepare(`
    SELECT horse_no,horse_name
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return { race, runners: rr.results || [] };
}

async function historyIngest(url, db) {
  await ensureHistoryTable(db);
  const { race, runners } = await resolveRace(url, db);

  const requestedLimit = Number(url.searchParams.get("limit") || 5);
  const historyLimit = Math.max(1, Math.min(10, Number.isFinite(requestedLimit) ? requestedLimit : 5));

  const racePage = await fetchHtml(race.source_url);
  if (!racePage.ok) throw new Error(`race page HTTP ${racePage.status}`);

  const runnerNames = runners.map((r) => r.horse_name);
  const profileLinks = extractProfileLinks(racePage.body, runnerNames, racePage.url);
  const tasks = runners.map((r) => ({ horseNo: r.horse_no, horseName: r.horse_name, profileUrl: profileLinks.get(r.horse_name) || null }));

  const fetched = await mapLimit(tasks, 4, async (task) => {
    if (!task.profileUrl) return { ...task, ok: false, reason: "profile link not found", performances: [] };
    try {
      const page = await fetchHtml(task.profileUrl);
      if (!page.ok) return { ...task, ok: false, reason: `HTTP ${page.status}`, performances: [] };
      const performances = parsePastPerformances(page.body, task.horseName, task.profileUrl, race.race_date, historyLimit);
      return { ...task, ok: true, performances };
    } catch (error) {
      return { ...task, ok: false, reason: String(error), performances: [] };
    }
  });

  const fetchedAt = new Date().toISOString();
  let savedRows = 0;
  let horsesWithHistory = 0;
  const results = [];

  for (const item of fetched) {
    if (!item.ok) {
      results.push({ horseNo: item.horseNo, horseName: item.horseName, status: "failed", reason: item.reason, rows: 0 });
      continue;
    }

    if (!item.performances.length) {
      results.push({ horseNo: item.horseNo, horseName: item.horseName, status: "no-prior-runs", rows: 0, profileUrl: item.profileUrl });
      continue;
    }

    const statements = item.performances.map((p) => db.prepare(`
      INSERT INTO jra_past_performances
        (horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,popularity,odds,jockey,assigned_weight,body_weight,body_weight_change,time_text,last3f,corner_positions,track_condition,source_url,fetched_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(horse_name,race_date,venue,race_name) DO UPDATE SET
        surface=excluded.surface,
        distance=excluded.distance,
        finish_position=excluded.finish_position,
        field_size=excluded.field_size,
        popularity=excluded.popularity,
        jockey=excluded.jockey,
        assigned_weight=excluded.assigned_weight,
        body_weight=excluded.body_weight,
        body_weight_change=excluded.body_weight_change,
        time_text=excluded.time_text,
        last3f=excluded.last3f,
        track_condition=excluded.track_condition,
        source_url=excluded.source_url,
        fetched_at=excluded.fetched_at
    `).bind(
      p.horseName,p.raceDate,p.venue,p.raceName,p.surface,p.distance,p.finishPosition,p.fieldSize,p.popularity,p.odds,p.jockey,
      p.assignedWeight,p.bodyWeight,p.bodyWeightChange,p.timeText,p.last3f,p.cornerPositions,p.trackCondition,p.sourceUrl,fetchedAt
    ));

    await db.batch(statements);
    savedRows += item.performances.length;
    horsesWithHistory += 1;
    results.push({
      horseNo: item.horseNo,
      horseName: item.horseName,
      status: "saved",
      rows: item.performances.length,
      newestPriorRace: item.performances[0]?.raceDate || null,
      oldestSavedRace: item.performances[item.performances.length - 1]?.raceDate || null,
      sample: item.performances[0] || null,
    });
  }

  const failed = results.filter((r) => r.status === "failed").length;
  const totalStored = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM jra_past_performances
    WHERE horse_name IN (${runners.map(() => "?").join(",")}) AND race_date < ?
  `).bind(...runnerNames, race.race_date).first();

  return {
    ok: failed === 0,
    stage: "official-history-ingested",
    version: "1.3.3",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      runnerCount: runners.length,
    },
    historyLimit,
    profileLinksFound: profileLinks.size,
    horsesWithHistory,
    savedRows,
    totalStoredRowsForField: Number(totalStored?.count || 0),
    failed,
    leakageGuard: `Only races before ${race.race_date} are stored`,
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
        version: "1.3.3",
        phase: "official past-performance ingestion",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/history-ingest") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        const result = await historyIngest(url, env.DB);
        return json(result, result.ok ? 200 : 502);
      } catch (error) {
        return json({ ok: false, version: "1.3.3", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
