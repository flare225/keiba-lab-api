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
        "SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,fetched_at FROM jra_races WHERE race_date=? ORDER BY venue,race_no"
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
      version: "1.1.2",
      requestedDate: requestedDate || tokyoDate(),
      date: resolved.date,
      fallbackToLatest: resolved.fallbackToLatest,
      raceCount: raceRows.length,
      runnerCount: Number(runners?.count || 0),
      ...diagnostics,
      races: raceRows,
    });
  } catch (error) {
    return json({ ok: false, version: "1.1.2", error: String(error) }, 400);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.1.2",
        phase: "date-aware full-day JRA status + gap diagnostics",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/jra/status") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      return statusResponse(url, env);
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
