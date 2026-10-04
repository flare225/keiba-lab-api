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
      "user-agent": "keiba-lab/1.0.1 (+official JRA D1 ingestion)",
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

const BAD = new Set([
  "ニュース", "企業情報", "社会貢献活動", "レース情報", "新規会員登録",
  "ホーム", "競馬メニュー", "レース成績データ", "重賞レース一覧",
  "スマートフォン", "サイトマップ", "リンク", "ご利用に際して",
  "ウェブアクセシビリティについて", "成績データ",
]);

function cleanName(value) {
  return text(value).replace(/^\d+\s*/, "").trim();
}

function plausibleHorseName(name) {
  return (
    name.length >= 2 &&
    name.length <= 18 &&
    /^[ァ-ヶー・ヴヷヸヹヺ]+$/.test(name) &&
    !BAD.has(name)
  );
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
      if (
        !profileCell &&
        /(牡|牝|せん)\s*[2-9]/.test(cell.text) &&
        /(4[89]|5[0-9]|6[0-2])(?:\.\d)?\s*(?:kg|キロ)/i.test(cell.text)
      ) {
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

    const profileAnchors = anchorTexts(profileCell.html)
      .filter((value) => value !== name && !plausibleHorseName(value));
    const allAnchors = anchorTexts(row);
    const jockey =
      profileAnchors[0] ||
      allAnchors.find(
        (value) => value !== name && value !== trainer && /[一-龠々]/.test(value) && value.length <= 12
      ) ||
      null;

    const numberCells = cells
      .map((cell) => cell.text)
      .filter((value) => /^(?:[1-9]|1[0-8])$/.test(value))
      .map(Number);
    const horseNo = numberCells.length ? numberCells[numberCells.length - 1] : null;

    const profileText = profileCell.text;
    const sexAgeIndex = profileText.search(/(牡|牝|せん)\s*[2-9]/);
    const weightPart = sexAgeIndex >= 0 ? profileText.slice(sexAgeIndex, sexAgeIndex + 80) : profileText;
    const weightMatch = weightPart.match(/(4[89]|5[0-9]|6[0-2])(?:\.([05]))?\s*(?:kg|キロ)/i);
    const assignedWeight = weightMatch
      ? Number(weightMatch[1] + (weightMatch[2] ? "." + weightMatch[2] : ""))
      : null;

    runners.push({
      frameNo: null,
      horseNo,
      name,
      sex: sexAge[1],
      age: Number(sexAge[2]),
      assignedWeight,
      jockey,
      trainer,
    });
    seen.add(name);
  }

  return runners;
}

function deriveFrameNo(horseNo, totalRunners) {
  if (!horseNo || !totalRunners || horseNo < 1 || horseNo > totalRunners) return null;
  if (totalRunners <= 8) return horseNo;

  const counts = Array(8).fill(1);
  let extras = totalRunners - 8;
  let frame = 7;
  while (extras > 0) {
    counts[frame] += 1;
    extras -= 1;
    frame -= 1;
    if (frame < 0) frame = 7;
  }

  let first = 1;
  for (let i = 0; i < counts.length; i++) {
    const last = first + counts[i] - 1;
    if (horseNo >= first && horseNo <= last) return i + 1;
    first = last + 1;
  }
  return null;
}

function applyFrameNumbers(runners) {
  const total = runners.length;
  return runners.map((runner) => ({
    ...runner,
    frameNo: runner.frameNo || deriveFrameNo(runner.horseNo, total),
  }));
}

function parseSeedLabel(label) {
  const match = String(label || "").match(
    /(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(1[0-2]|[1-9])R/
  );
  return {
    venue: match?.[1] || null,
    raceNo: match?.[2] ? Number(match[2]) : null,
  };
}

function findRaceName(html) {
  for (const heading of html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) {
    const value = text(heading[1]);
    if (
      value && value !== "出馬表" && !/関連メニュー|検索/.test(value) &&
      value.length <= 50 &&
      /毎日王冠|京都大賞典|ステークス|賞|未勝利|新馬|クラス|オープン/.test(value)
    ) {
      return value;
    }
  }
  return null;
}

function courseFromContext(allText, raceName) {
  let context = allText;
  if (raceName) {
    const index = allText.indexOf(raceName);
    if (index >= 0) context = allText.slice(Math.max(0, index - 250), index + 1400);
  }

  const patterns = [
    /(芝|ダート|障害)\s*([123][0-9]{3})\s*(?:m|メートル)?/i,
    /([123][0-9]{3})\s*(?:m|メートル)?\s*(芝|ダート|障害)/i,
    /コース：[^。]{0,120}(芝|ダート|障害)[^0-9]{0,30}([123][0-9]{3})/i,
  ];

  for (const pattern of patterns) {
    const match = context.match(pattern);
    if (!match) continue;
    if (/^\d/.test(match[1])) {
      return { surface: match[2] || null, distance: Number(match[1]) || null };
    }
    return { surface: match[1] || null, distance: Number(match[2]) || null };
  }
  return { surface: null, distance: null };
}

function parseOfficialRacecard(page, seed) {
  const allText = text(page.body);
  const title = text(page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const raceName = findRaceName(page.body);
  const seedMeta = parseSeedLabel(seed?.label);
  const course = courseFromContext(allText, raceName);
  const runners = applyFrameNumbers(extractOfficialRunners(page.body));

  return {
    sourceUrl: page.url,
    title,
    raceName,
    venue: seedMeta.venue,
    raceNo: seedMeta.raceNo,
    surface: course.surface,
    distance: course.distance,
    runnerCount: runners.length,
    runners,
  };
}

function officialSeeds(date) {
  if (date === "2026-10-04") {
    return [
      {
        label: "東京11R 毎日王冠",
        url: "https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604021120261004%2FC5",
      },
      {
        label: "京都11R 京都大賞典",
        url: "https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0108202604021120261004%2FA3",
      },
    ];
  }
  return [];
}

async function officialProbe() {
  const date = tokyoDate();
  const seeds = officialSeeds(date);
  if (!seeds.length) {
    return {
      ok: false,
      stage: "official-racecard",
      version: "1.0.1",
      date,
      error: "No official seed configured for this date",
    };
  }

  const races = [];
  const sameDayLinks = new Set();
  for (const seed of seeds) {
    try {
      const page = await fetchHtml(seed.url);
      if (!page.ok) {
        races.push({ label: seed.label, sourceUrl: seed.url, error: `HTTP ${page.status}` });
        continue;
      }
      for (const url of extractLinks(page.body, page.url)) {
        if (url.includes("/JRADB/accessD.html") && url.includes(date.replaceAll("-", ""))) {
          sameDayLinks.add(url);
        }
      }
      races.push({ label: seed.label, ...parseOfficialRacecard(page, seed) });
    } catch (error) {
      races.push({ label: seed.label, sourceUrl: seed.url, error: String(error) });
    }
  }

  const totalRunners = races.reduce((count, race) => count + (race.runnerCount || 0), 0);
  return {
    ok: races.some((race) => race.runnerCount > 0),
    stage: "official-runner-parse",
    version: "1.0.1",
    date,
    seedCount: seeds.length,
    discoveredSameDayRacecardLinks: sameDayLinks.size,
    totalRunners,
    races,
  };
}

async function ensureJraTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS jra_races (
      race_key TEXT PRIMARY KEY,
      race_date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      race_name TEXT,
      surface TEXT,
      distance INTEGER,
      source_url TEXT,
      runner_count INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS jra_runners (
      race_key TEXT NOT NULL,
      horse_no INTEGER NOT NULL,
      frame_no INTEGER,
      horse_name TEXT NOT NULL,
      sex TEXT,
      age INTEGER,
      assigned_weight REAL,
      jockey TEXT,
      trainer TEXT,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (race_key, horse_no)
    )`,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_jra_races_unique ON jra_races(race_date, venue, race_no)",
    "CREATE INDEX IF NOT EXISTS idx_jra_races_date ON jra_races(race_date, venue, race_no)",
    "CREATE INDEX IF NOT EXISTS idx_jra_runners_race ON jra_runners(race_key, horse_no)",
  ];

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

function validRaceForPersistence(race) {
  return (
    race && race.venue && Number.isInteger(race.raceNo) &&
    race.raceNo >= 1 && race.raceNo <= 12 &&
    Array.isArray(race.runners) && race.runners.length > 0 &&
    race.runners.every((runner) => runner.horseNo && runner.name)
  );
}

async function persistOfficialProbe(db, probe) {
  await ensureJraTables(db);

  const fetchedAt = new Date().toISOString();
  let persistedRaces = 0;
  let persistedRunners = 0;
  const saved = [];

  for (const race of probe.races || []) {
    if (!validRaceForPersistence(race)) {
      saved.push({
        venue: race?.venue || null,
        raceNo: race?.raceNo || null,
        status: "skipped",
        reason: "race failed persistence validation",
      });
      continue;
    }

    const raceKey = `${probe.date}:${race.venue}:${race.raceNo}`;

    await db.prepare(`
      INSERT INTO jra_races (
        race_key, race_date, venue, race_no, race_name, surface,
        distance, source_url, runner_count, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(race_key) DO UPDATE SET
        race_name = excluded.race_name,
        surface = excluded.surface,
        distance = excluded.distance,
        source_url = excluded.source_url,
        runner_count = excluded.runner_count,
        fetched_at = excluded.fetched_at
    `).bind(
      raceKey, probe.date, race.venue, race.raceNo, race.raceName,
      race.surface, race.distance, race.sourceUrl, race.runnerCount, fetchedAt
    ).run();

    await db.prepare("DELETE FROM jra_runners WHERE race_key = ?").bind(raceKey).run();

    for (const runner of race.runners) {
      await db.prepare(`
        INSERT INTO jra_runners (
          race_key, horse_no, frame_no, horse_name, sex, age,
          assigned_weight, jockey, trainer, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        raceKey, runner.horseNo, runner.frameNo, runner.name, runner.sex,
        runner.age, runner.assignedWeight, runner.jockey, runner.trainer, fetchedAt
      ).run();
      persistedRunners += 1;
    }

    persistedRaces += 1;
    saved.push({
      raceKey,
      venue: race.venue,
      raceNo: race.raceNo,
      raceName: race.raceName,
      runnerCount: race.runnerCount,
      status: "saved",
    });
  }

  return {
    ok: persistedRaces > 0,
    stage: "d1-persisted",
    version: "1.0.1",
    date: probe.date,
    persistedRaces,
    persistedRunners,
    saved,
  };
}

async function inspectSchema(db) {
  const tableResult = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all();

  const tables = [];
  for (const row of tableResult.results || []) {
    const name = String(row.name);
    if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
    const columns = await db.prepare(`PRAGMA table_info(${name})`).all();
    tables.push({ name, columns: columns.results || [] });
  }
  return tables;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        return json({
          ok: true,
          service: "keiba-lab-api",
          version: "1.0.1",
          phase: "official JRA -> D1 ingestion",
          missing: env.DB ? [] : ["D1 binding: DB"],
        });
      }

      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        return json({ ok: true, database: "connected", tables: result.results });
      }

      if (url.pathname === "/v1/schema") {
        const tables = await inspectSchema(env.DB);
        return json({ ok: true, database: "connected", tableCount: tables.length, tables });
      }

      if (url.pathname === "/v1/jra/test") {
        const seeds = officialSeeds(tokyoDate());
        if (!seeds.length) return json({ ok: false, error: "No seed for today" }, 404);
        const result = await fetchHtml(seeds[0].url);
        return json({ source: "JRA JRADB", ok: result.ok, status: result.status, bytes: result.bytes, url: result.url }, result.ok ? 200 : 502);
      }

      if (url.pathname === "/v1/jra/discover") return json(await officialProbe());

      if (url.pathname === "/v1/jra/ingest") {
        const probe = await officialProbe();
        if (!probe.ok) return json(probe, 502);
        const persisted = await persistOfficialProbe(env.DB, probe);
        return json({
          ...persisted,
          discoveredSameDayRacecardLinks: probe.discoveredSameDayRacecardLinks,
          parsedRaces: probe.races.length,
          parsedRunners: probe.totalRunners,
        });
      }

      if (url.pathname === "/v1/jra/status") {
        await ensureJraTables(env.DB);
        const date = tokyoDate();
        const races = await env.DB.prepare(
          "SELECT race_key, race_date, venue, race_no, race_name, surface, distance, runner_count, fetched_at FROM jra_races WHERE race_date = ? ORDER BY venue, race_no"
        ).bind(date).all();
        const runners = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM jra_runners WHERE race_key IN (SELECT race_key FROM jra_races WHERE race_date = ?)"
        ).bind(date).first();
        return json({
          ok: true,
          stage: "d1-status",
          version: "1.0.1",
          date,
          raceCount: races.results.length,
          runnerCount: runners?.count || 0,
          races: races.results,
        });
      }

      if (url.pathname === "/api/jra/races") {
        await ensureJraTables(env.DB);
        const result = await env.DB.prepare("SELECT * FROM jra_races ORDER BY race_date DESC, venue, race_no LIMIT 100").all();
        return json({ ok: true, count: result.results.length, data: result.results });
      }

      if (url.pathname === "/api/jra/runners") {
        await ensureJraTables(env.DB);
        const raceKey = url.searchParams.get("race_key");
        if (!raceKey) return json({ ok: false, error: "race_key is required" }, 400);
        const result = await env.DB.prepare("SELECT * FROM jra_runners WHERE race_key = ? ORDER BY horse_no").bind(raceKey).all();
        return json({ ok: true, raceKey, count: result.results.length, data: result.results });
      }

      if (url.pathname === "/v1/meetings/today") {
        const date = tokyoDate();
        const result = await env.DB.prepare(
          "SELECT venue, race_date, COUNT(*) AS race_count FROM races WHERE race_date = ? GROUP BY venue, race_date ORDER BY venue"
        ).bind(date).all();
        return json({ ok: true, date, meetings: result.results });
      }

      if (url.pathname === "/api/races") {
        const result = await env.DB.prepare("SELECT * FROM races ORDER BY race_date DESC, venue, race_no LIMIT 100").all();
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
        const probe = await officialProbe();
        if (!probe.ok) {
          console.error("JRA scheduled probe failed", JSON.stringify(probe));
          return;
        }
        const persisted = await persistOfficialProbe(env.DB, probe);
        console.log("JRA scheduled persistence", JSON.stringify(persisted));
      } catch (error) {
        console.error("JRA scheduled persistence failed", String(error));
      }
    })());
  },
};
