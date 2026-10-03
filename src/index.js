function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
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
          version: "0.2.0",
          missing: env.DB ? [] : ["D1 binding: DB"],
        });
      }

      if (!env.DB) {
        return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      }

      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const result = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all();

        return json({
          ok: true,
          database: "connected",
          tables: result.results,
        });
      }

      if (url.pathname === "/v1/meetings/today") {
        const date = tokyoDate();
        const result = await env.DB
          .prepare(
            `SELECT venue, race_date, COUNT(*) AS race_count
             FROM races
             WHERE race_date = ?
             GROUP BY venue, race_date
             ORDER BY venue`
          )
          .bind(date)
          .all();

        return json({ ok: true, date, meetings: result.results });
      }

      if (url.pathname === "/api/races") {
        const result = await env.DB
          .prepare("SELECT * FROM races ORDER BY race_date DESC, venue, race_no LIMIT 100")
          .all();

        return json({ ok: true, count: result.results.length, data: result.results });
      }

      if (url.pathname === "/api/predictions") {
        const result = await env.DB
          .prepare("SELECT * FROM predictions ORDER BY id DESC LIMIT 100")
          .all();

        return json({ ok: true, count: result.results.length, data: result.results });
      }

      if (url.pathname === "/api/validations") {
        const result = await env.DB
          .prepare("SELECT * FROM validations ORDER BY id DESC LIMIT 100")
          .all();

        return json({ ok: true, count: result.results.length, data: result.results });
      }

      if (url.pathname === "/v1/test/insert") {
        const date = tokyoDate();
        const now = new Date().toISOString();

        await env.DB
          .prepare(
            `INSERT OR REPLACE INTO races
             (venue, race_date, race_no, surface, distance, going, source, fetched_at, raw_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            "TEST",
            date,
            1,
            "芝",
            1200,
            "良",
            "manual-test",
            now,
            JSON.stringify({ test: true, message: "keiba-lab D1 write test" })
          )
          .run();

        return json({
          ok: true,
          message: "D1 write OK",
          venue: "TEST",
          race_date: date,
          race_no: 1,
        });
      }

      return json({ ok: false, error: "Not Found" }, 404);
    } catch (error) {
      return json({ ok: false, error: String(error) }, 500);
    }
  },
};
