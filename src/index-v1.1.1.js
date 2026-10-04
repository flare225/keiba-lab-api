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

    const runners = await env.DB
      .prepare(
        "SELECT COUNT(*) AS count FROM jra_runners WHERE race_key IN (SELECT race_key FROM jra_races WHERE race_date=?)"
      )
      .bind(resolved.date)
      .first();

    return json({
      ok: true,
      stage: "full-day-d1-status",
      version: "1.1.1",
      requestedDate: requestedDate || tokyoDate(),
      date: resolved.date,
      fallbackToLatest: resolved.fallbackToLatest,
      raceCount: races.results?.length || 0,
      runnerCount: Number(runners?.count || 0),
      races: races.results || [],
    });
  } catch (error) {
    return json({ ok: false, version: "1.1.1", error: String(error) }, 400);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.1.1",
        phase: "date-aware full-day JRA status",
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
