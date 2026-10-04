import app from "./index-v1.1.4.js";

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

async function ensureLabTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS lab_runner_catalog (
      horse_name TEXT PRIMARY KEY,
      sex TEXT,
      latest_age INTEGER,
      trainer TEXT,
      first_seen_date TEXT NOT NULL,
      last_seen_date TEXT NOT NULL,
      appearances_seen INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS jra_past_performances (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_lab_runner_catalog_last_seen ON lab_runner_catalog(last_seen_date, horse_name)`,
    `CREATE INDEX IF NOT EXISTS idx_jra_past_perf_horse_date ON jra_past_performances(horse_name, race_date DESC)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}

async function rebuildRunnerCatalog(db) {
  await ensureLabTables(db);
  const now = new Date().toISOString();
  const rows = await db.prepare(`
    SELECT
      rr.horse_name,
      MAX(rr.sex) AS sex,
      MAX(rr.age) AS latest_age,
      MAX(rr.trainer) AS trainer,
      MIN(r.race_date) AS first_seen_date,
      MAX(r.race_date) AS last_seen_date,
      COUNT(*) AS appearances_seen
    FROM jra_runners rr
    JOIN jra_races r ON r.race_key = rr.race_key
    GROUP BY rr.horse_name
    ORDER BY rr.horse_name
  `).all();

  let upserted = 0;
  for (const row of rows.results || []) {
    await db.prepare(`
      INSERT INTO lab_runner_catalog
        (horse_name,sex,latest_age,trainer,first_seen_date,last_seen_date,appearances_seen,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(horse_name) DO UPDATE SET
        sex=excluded.sex,
        latest_age=excluded.latest_age,
        trainer=excluded.trainer,
        first_seen_date=MIN(lab_runner_catalog.first_seen_date, excluded.first_seen_date),
        last_seen_date=MAX(lab_runner_catalog.last_seen_date, excluded.last_seen_date),
        appearances_seen=excluded.appearances_seen,
        updated_at=excluded.updated_at
    `).bind(
      row.horse_name,
      row.sex,
      row.latest_age,
      row.trainer,
      row.first_seen_date,
      row.last_seen_date,
      Number(row.appearances_seen || 0),
      now
    ).run();
    upserted += 1;
  }

  const perfCount = await db.prepare("SELECT COUNT(*) AS count FROM jra_past_performances").first();
  return {
    ok: true,
    stage: "lab-foundation-ready",
    version: "1.2.0",
    catalogHorses: upserted,
    pastPerformanceRows: Number(perfCount?.count || 0),
    next: "Collect official past performances per horse, then compute recent-form/course-distance/pace/ground features",
  };
}

async function resolveDate(db, requestedDate) {
  if (requestedDate) {
    if (!validDate(requestedDate)) throw new Error("date must be YYYY-MM-DD");
    return requestedDate;
  }
  const latest = await db.prepare("SELECT MAX(race_date) AS date FROM jra_races").first();
  return latest?.date || tokyoDate();
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((Number(num || 0) / Number(den)) * 1000) / 10;
}

async function readinessResponse(url, db) {
  await ensureLabTables(db);
  const date = await resolveDate(db, url.searchParams.get("date"));

  const raceStats = await db.prepare(`
    SELECT
      COUNT(*) AS race_count,
      SUM(CASE WHEN race_name IS NOT NULL AND race_name <> '' THEN 1 ELSE 0 END) AS race_name_ok,
      SUM(CASE WHEN surface IS NOT NULL AND surface <> '' THEN 1 ELSE 0 END) AS surface_ok,
      SUM(CASE WHEN distance IS NOT NULL THEN 1 ELSE 0 END) AS distance_ok
    FROM jra_races
    WHERE race_date=?
  `).bind(date).first();

  const runnerStats = await db.prepare(`
    SELECT
      COUNT(*) AS runner_count,
      SUM(CASE WHEN rr.horse_name IS NOT NULL AND rr.horse_name <> '' THEN 1 ELSE 0 END) AS horse_name_ok,
      SUM(CASE WHEN rr.horse_no IS NOT NULL THEN 1 ELSE 0 END) AS horse_no_ok,
      SUM(CASE WHEN rr.frame_no IS NOT NULL THEN 1 ELSE 0 END) AS frame_no_ok,
      SUM(CASE WHEN rr.jockey IS NOT NULL AND rr.jockey <> '' THEN 1 ELSE 0 END) AS jockey_ok,
      SUM(CASE WHEN rr.trainer IS NOT NULL AND rr.trainer <> '' THEN 1 ELSE 0 END) AS trainer_ok,
      SUM(CASE WHEN rr.assigned_weight IS NOT NULL THEN 1 ELSE 0 END) AS weight_ok
    FROM jra_runners rr
    JOIN jra_races r ON r.race_key=rr.race_key
    WHERE r.race_date=?
  `).bind(date).first();

  const perfCount = await db.prepare("SELECT COUNT(*) AS count FROM jra_past_performances").first();
  const catalogCount = await db.prepare("SELECT COUNT(*) AS count FROM lab_runner_catalog").first();
  const raceCount = Number(raceStats?.race_count || 0);
  const runnerCount = Number(runnerStats?.runner_count || 0);
  const pastRows = Number(perfCount?.count || 0);

  return {
    ok: true,
    stage: "analysis-readiness",
    version: "1.2.0",
    date,
    raceCount,
    runnerCount,
    catalogHorses: Number(catalogCount?.count || 0),
    pastPerformanceRows: pastRows,
    completeness: {
      raceNamePct: pct(raceStats?.race_name_ok, raceCount),
      surfacePct: pct(raceStats?.surface_ok, raceCount),
      distancePct: pct(raceStats?.distance_ok, raceCount),
      horseNamePct: pct(runnerStats?.horse_name_ok, runnerCount),
      horseNoPct: pct(runnerStats?.horse_no_ok, runnerCount),
      frameNoPct: pct(runnerStats?.frame_no_ok, runnerCount),
      jockeyPct: pct(runnerStats?.jockey_ok, runnerCount),
      trainerPct: pct(runnerStats?.trainer_ok, runnerCount),
      assignedWeightPct: pct(runnerStats?.weight_ok, runnerCount),
    },
    analysisBlocks: [
      { name: "current-entry-data", status: runnerCount > 0 ? "ready" : "missing" },
      { name: "race-course-distance", status: raceCount > 0 && Number(raceStats?.surface_ok || 0) === raceCount && Number(raceStats?.distance_ok || 0) === raceCount ? "ready" : "partial" },
      { name: "past-performance-history", status: pastRows > 0 ? "partial" : "next" },
      { name: "recent-form", status: pastRows > 0 ? "partial" : "blocked-by-history" },
      { name: "course-distance-fit", status: pastRows > 0 ? "partial" : "blocked-by-history" },
      { name: "running-style-pace", status: "not-yet-collected" },
      { name: "ground-fit", status: "not-yet-collected" },
      { name: "condition-prep", status: "not-yet-collected" },
    ],
    next: "Populate jra_past_performances from official horse/race history before assigning prediction scores",
  };
}

async function raceDetailResponse(url, db) {
  const date = await resolveDate(db, url.searchParams.get("date"));
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    return json({ ok: false, version: "1.2.0", error: "venue and race_no (1-12) are required" }, 400);
  }

  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count,fetched_at
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) return json({ ok: false, version: "1.2.0", error: "race not found", date, venue, raceNo }, 404);

  const runners = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer,fetched_at
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return json({
    ok: true,
    stage: "lab-race-detail",
    version: "1.2.0",
    race,
    runnerCount: runners.results?.length || 0,
    runners: runners.results || [],
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.2.0",
        phase: "analysis foundation",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);

    try {
      if (url.pathname === "/v1/lab/bootstrap") {
        return json(await rebuildRunnerCatalog(env.DB));
      }

      if (url.pathname === "/v1/lab/readiness") {
        return json(await readinessResponse(url, env.DB));
      }

      if (url.pathname === "/v1/lab/race") {
        return raceDetailResponse(url, env.DB);
      }
    } catch (error) {
      return json({ ok: false, version: "1.2.0", error: String(error) }, 500);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
