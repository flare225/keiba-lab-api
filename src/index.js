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

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "keiba-lab/1.1.0 (+full-day official JRA ingestion)",
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
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    bytes: buffer.byteLength,
    body,
  };
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
  const links = [];
  const seen = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base).href;
      if (!url.startsWith("https://www.jra.go.jp/") || seen.has(url)) continue;
      seen.add(url);
      links.push(url);
    } catch {}
  }
  return links;
}

const VENUE_BY_CODE = {
  "01": "札幌", "02": "函館", "03": "福島", "04": "新潟", "05": "東京",
  "06": "中山", "07": "中京", "08": "京都", "09": "阪神", "10": "小倉",
};

function raceMetaFromUrl(url, expectedDate) {
  try {
    const parsed = new URL(url);
    const cname = parsed.searchParams.get("CNAME") || "";
    const match = cname.match(/^pw01dde01(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})(\d{8})/i);
    if (!match) return null;
    const venue = VENUE_BY_CODE[match[1]] || null;
    const raceNo = Number(match[5]);
    const raceDate = `${match[6].slice(0,4)}-${match[6].slice(4,6)}-${match[6].slice(6,8)}`;
    if (!venue || raceNo < 1 || raceNo > 12) return null;
    if (expectedDate && raceDate !== expectedDate) return null;
    return { venue, raceNo, raceDate, url };
  } catch {
    return null;
  }
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

function firstAnchorTexts(html) {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => cleanName(m[1]))
    .filter(Boolean);
}

function extractOfficialRunners(html) {
  const runners = [];
  const seen = new Set();
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const rowText = text(row);
    if (!/父：/.test(rowText) || !/母：/.test(rowText)) continue;
    const sexAge = rowText.match(/(牡|牝|せん)\s*([2-9])/);
    if (!sexAge) continue;
    const cells = cellBlocks(row);
    if (cells.length < 3) continue;

    let horseCell = null;
    let profileCell = null;
    for (const cell of cells) {
      if (!horseCell && /父：/.test(cell.text) && /母：/.test(cell.text)) horseCell = cell;
      if (!profileCell && /(牡|牝|せん)\s*[2-9]/.test(cell.text) && /(4[89]|5[0-9]|6[0-2])(?:\.\d)?\s*(?:kg|キロ)/i.test(cell.text)) profileCell = cell;
    }
    if (!horseCell || !profileCell) continue;

    const horseAnchors = firstAnchorTexts(horseCell.html);
    const name = horseAnchors.find(plausibleHorseName) || null;
    if (!name || seen.has(name)) continue;

    let trainer = null;
    for (const value of horseAnchors) {
      if (value !== name && /[一-龠々]/.test(value)) { trainer = value; break; }
    }

    const profileAnchors = firstAnchorTexts(profileCell.html).filter((v) => v !== name && !plausibleHorseName(v));
    const allAnchors = firstAnchorTexts(row);
    const jockey = profileAnchors[0] || allAnchors.find((v) => v !== name && v !== trainer && /[一-龠々]/.test(v) && v.length <= 12) || null;

    const numberCells = cells.map((c) => c.text).filter((v) => /^(?:[1-9]|1[0-8])$/.test(v)).map(Number);
    const horseNo = numberCells.length ? numberCells[numberCells.length - 1] : null;

    const profileText = profileCell.text;
    const sexAgeIndex = profileText.search(/(牡|牝|せん)\s*[2-9]/);
    const weightPart = sexAgeIndex >= 0 ? profileText.slice(sexAgeIndex, sexAgeIndex + 80) : profileText;
    const weightMatch = weightPart.match(/(4[89]|5[0-9]|6[0-2])(?:\.([05]))?\s*(?:kg|キロ)/i);
    const assignedWeight = weightMatch ? Number(weightMatch[1] + (weightMatch[2] ? "." + weightMatch[2] : "")) : null;

    runners.push({ frameNo: null, horseNo, name, sex: sexAge[1], age: Number(sexAge[2]), assignedWeight, jockey, trainer });
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
    counts = Array.from({ length: 8 }, (_, i) => i < singles ? 1 : 2);
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

function applyFrameNumbers(runners) {
  return runners.map((runner) => ({ ...runner, frameNo: deriveFrameNo(runner.horseNo, runners.length) }));
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
    /(芝|ダート|障害)\s*([123][0-9]{3})\s*(?:m|メートル)?/i,
    /([123][0-9]{3})\s*(?:m|メートル)?\s*(芝|ダート|障害)/i,
    /コース：[^。]{0,120}(芝|ダート|障害)[^0-9]{0,30}([123][0-9]{3})/i,
  ];
  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (!match) continue;
    if (/^\d/.test(match[1])) return { surface: match[2] || null, distance: Number(match[1]) || null };
    return { surface: match[1] || null, distance: Number(match[2]) || null };
  }
  return { surface: null, distance: null };
}

function parseOfficialRacecard(page, meta) {
  const allText = text(page.body);
  const raceName = findRaceName(page.body);
  const course = courseFromContext(allText, raceName);
  const runners = applyFrameNumbers(extractOfficialRunners(page.body));
  return {
    sourceUrl: page.url,
    raceDate: meta.raceDate,
    venue: meta.venue,
    raceNo: meta.raceNo,
    raceName,
    surface: course.surface,
    distance: course.distance,
    runnerCount: runners.length,
    runners,
  };
}

function configuredSeeds(date) {
  if (date !== "2026-10-04") return [];
  return [
    "https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604021120261004%2FC5",
    "https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604021120261004%2FA3",
  ];
}

async function discoverSameDayRacecards(date) {
  const seeds = configuredSeeds(date);
  if (!seeds.length) return { ok: false, date, error: "No bootstrap seed configured for this date", entries: [] };

  const byKey = new Map();
  for (const seed of seeds) {
    const seedMeta = raceMetaFromUrl(seed, date);
    if (seedMeta) byKey.set(`${seedMeta.venue}:${seedMeta.raceNo}`, seedMeta);
    const page = await fetchHtml(seed);
    if (!page.ok) continue;
    for (const link of extractLinks(page.body, page.url)) {
      const meta = raceMetaFromUrl(link, date);
      if (!meta) continue;
      byKey.set(`${meta.venue}:${meta.raceNo}`, meta);
    }
  }

  const entries = [...byKey.values()].sort((a, b) => {
    const venueOrder = Object.values(VENUE_BY_CODE);
    const av = venueOrder.indexOf(a.venue), bv = venueOrder.indexOf(b.venue);
    return av - bv || a.raceNo - b.raceNo;
  });

  return { ok: entries.length > 0, date, entries };
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

async function fullDayProbe() {
  const date = tokyoDate();
  const discovery = await discoverSameDayRacecards(date);
  if (!discovery.ok) return { ok: false, stage: "full-day-discovery", version: "1.1.0", date, error: discovery.error, races: [] };

  const races = await mapLimit(discovery.entries, 4, async (meta) => {
    try {
      const page = await fetchHtml(meta.url);
      if (!page.ok) return { ...meta, error: `HTTP ${page.status}`, runnerCount: 0, runners: [] };
      return parseOfficialRacecard(page, meta);
    } catch (error) {
      return { ...meta, error: String(error), runnerCount: 0, runners: [] };
    }
  });

  const valid = races.filter((race) => race.runnerCount > 0);
  const totalRunners = valid.reduce((n, race) => n + race.runnerCount, 0);
  const venues = [...new Set(valid.map((r) => r.venue))];
  return {
    ok: valid.length > 0,
    stage: "full-day-parsed",
    version: "1.1.0",
    date,
    discoveredRacecards: discovery.entries.length,
    parsedRaces: valid.length,
    totalRunners,
    venues,
    races,
  };
}

async function ensureJraTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS jra_races (race_key TEXT PRIMARY KEY, race_date TEXT NOT NULL, venue TEXT NOT NULL, race_no INTEGER NOT NULL, race_name TEXT, surface TEXT, distance INTEGER, source_url TEXT, runner_count INTEGER NOT NULL DEFAULT 0, fetched_at TEXT NOT NULL, UNIQUE(race_date, venue, race_no))`,
    `CREATE TABLE IF NOT EXISTS jra_runners (race_key TEXT NOT NULL, horse_no INTEGER NOT NULL, frame_no INTEGER, horse_name TEXT NOT NULL, sex TEXT, age INTEGER, assigned_weight REAL, jockey TEXT, trainer TEXT, fetched_at TEXT NOT NULL, PRIMARY KEY (race_key, horse_no))`,
    `CREATE INDEX IF NOT EXISTS idx_jra_races_date ON jra_races(race_date, venue, race_no)`,
    `CREATE INDEX IF NOT EXISTS idx_jra_runners_race ON jra_runners(race_key, horse_no)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

function validRaceForPersistence(race) {
  return race && race.venue && Number.isInteger(race.raceNo) && race.raceNo >= 1 && race.raceNo <= 12 && Array.isArray(race.runners) && race.runners.length > 0 && race.runners.every((r) => r.horseNo && r.name);
}

async function persistFullDay(db, probe) {
  await ensureJraTables(db);
  const fetchedAt = new Date().toISOString();
  let persistedRaces = 0;
  let persistedRunners = 0;
  const saved = [];

  for (const race of probe.races || []) {
    if (!validRaceForPersistence(race)) {
      saved.push({ venue: race?.venue || null, raceNo: race?.raceNo || null, status: "skipped", reason: race?.error || "validation" });
      continue;
    }
    const raceKey = `${probe.date}:${race.venue}:${race.raceNo}`;
    const statements = [
      db.prepare(`INSERT INTO jra_races (race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(race_key) DO UPDATE SET race_name=excluded.race_name,surface=excluded.surface,distance=excluded.distance,source_url=excluded.source_url,runner_count=excluded.runner_count,fetched_at=excluded.fetched_at`)
        .bind(raceKey, probe.date, race.venue, race.raceNo, race.raceName, race.surface, race.distance, race.sourceUrl, race.runnerCount, fetchedAt),
      db.prepare(`DELETE FROM jra_runners WHERE race_key = ?`).bind(raceKey),
    ];
    for (const runner of race.runners) {
      statements.push(db.prepare(`INSERT INTO jra_runners (race_key,horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(raceKey, runner.horseNo, runner.frameNo, runner.name, runner.sex, runner.age, runner.assignedWeight, runner.jockey, runner.trainer, fetchedAt));
    }
    await db.batch(statements);
    persistedRaces += 1;
    persistedRunners += race.runners.length;
    saved.push({ raceKey, venue: race.venue, raceNo: race.raceNo, raceName: race.raceName, runnerCount: race.runnerCount, status: "saved" });
  }

  return { ok: persistedRaces > 0, stage: "full-day-d1-persisted", version: "1.1.0", date: probe.date, persistedRaces, persistedRunners, saved };
}

async function inspectSchema(db) {
  const result = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
  const tables = [];
  for (const row of result.results || []) {
    const name = String(row.name);
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const columns = await db.prepare(`PRAGMA table_info(${name})`).all();
    tables.push({ name, columns: columns.results || [] });
  }
  return tables;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*" } });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return json({ ok: true, service: "keiba-lab-api", version: "1.1.0", phase: "full-day JRA -> D1 ingestion", missing: env.DB ? [] : ["D1 binding: DB"] });
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        return json({ ok: true, database: "connected", tables: result.results });
      }
      if (url.pathname === "/v1/schema") {
        const tables = await inspectSchema(env.DB);
        return json({ ok: true, database: "connected", tableCount: tables.length, tables });
      }
      if (url.pathname === "/v1/jra/discover") {
        const discovery = await discoverSameDayRacecards(tokyoDate());
        return json({ ok: discovery.ok, stage: "full-day-discovery", version: "1.1.0", date: discovery.date, count: discovery.entries.length, entries: discovery.entries });
      }
      if (url.pathname === "/v1/jra/ingest") {
        const probe = await fullDayProbe();
        if (!probe.ok) return json(probe, 502);
        const persisted = await persistFullDay(env.DB, probe);
        return json({
          ...persisted,
          discoveredRacecards: probe.discoveredRacecards,
          parsedRaces: probe.parsedRaces,
          parsedRunners: probe.totalRunners,
          venues: probe.venues,
        });
      }
      if (url.pathname === "/v1/jra/status") {
        await ensureJraTables(env.DB);
        const date = tokyoDate();
        const races = await env.DB.prepare("SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,fetched_at FROM jra_races WHERE race_date=? ORDER BY venue,race_no").bind(date).all();
        const runners = await env.DB.prepare("SELECT COUNT(*) AS count FROM jra_runners WHERE race_key IN (SELECT race_key FROM jra_races WHERE race_date=?)").bind(date).first();
        return json({ ok: true, stage: "full-day-d1-status", version: "1.1.0", date, raceCount: races.results.length, runnerCount: runners?.count || 0, races: races.results });
      }
      if (url.pathname === "/api/jra/races") {
        await ensureJraTables(env.DB);
        const result = await env.DB.prepare("SELECT * FROM jra_races ORDER BY race_date DESC,venue,race_no LIMIT 200").all();
        return json({ ok: true, count: result.results.length, data: result.results });
      }
      if (url.pathname === "/api/jra/runners") {
        await ensureJraTables(env.DB);
        const raceKey = url.searchParams.get("race_key");
        if (!raceKey) return json({ ok: false, error: "race_key is required" }, 400);
        const result = await env.DB.prepare("SELECT * FROM jra_runners WHERE race_key=? ORDER BY horse_no").bind(raceKey).all();
        return json({ ok: true, raceKey, count: result.results.length, data: result.results });
      }
      if (url.pathname === "/v1/meetings/today") {
        await ensureJraTables(env.DB);
        const date = tokyoDate();
        const result = await env.DB.prepare("SELECT venue,race_date,COUNT(*) AS race_count FROM jra_races WHERE race_date=? GROUP BY venue,race_date ORDER BY venue").bind(date).all();
        return json({ ok: true, date, meetings: result.results });
      }
      if (url.pathname === "/api/races") {
        const result = await env.DB.prepare("SELECT * FROM races ORDER BY race_date DESC,venue,race_no LIMIT 100").all();
        return json({ ok: true, count: result.results.length, data: result.results });
      }
      if (url.pathname === "/api/predictions") {
        const result = await env.DB.prepare("SELECT * FROM predictions ORDER BY id DESC LIMIT 100").all();
        return json({ ok: true, count: result.results.length, data: result.results });
      }
      if (url.pathname === "/api/validations") {
        const result = await env.DB.prepare("SELECT * FROM validations ORDER BY id DESC LIMIT 100").all();
        return json({ ok: true, count: result.results.length, data: result.results });
      }
      return json({ ok: false, error: "Not Found" }, 404);
    } catch (error) {
      return json({ ok: false, error: String(error), stack: error?.stack || null }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const probe = await fullDayProbe();
        if (!probe.ok) return console.error("JRA full-day probe failed", JSON.stringify(probe));
        const result = await persistFullDay(env.DB, probe);
        console.log("JRA full-day persistence", JSON.stringify({ ok: result.ok, races: result.persistedRaces, runners: result.persistedRunners }));
      } catch (error) {
        console.error("JRA full-day persistence failed", String(error));
      }
    })());
  },
};
