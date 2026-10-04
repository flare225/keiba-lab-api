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

async function testJraConnection() {
  const startedAt = new Date().toISOString();
  const response = await fetch("https://www.jra.go.jp/", {
    headers: {
      "user-agent": "keiba-lab/0.3 (+JRA connectivity test)",
      accept: "text/html,*/*;q=0.8",
    },
    redirect: "follow",
  });

  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: body.length,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
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
          version: "0.3.0",
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
        return json({ ok: true, database: "connected", tables: result.results });
      }

      if (url.pathname === "/v1/jra/test") {
        const result = await testJraConnection();
        return json({ source: "JRA", ...result }, result.ok ? 200 : 502);
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

      return json({ ok: false, error: "Not Found" }, 404);
    } catch (error) {
      return json({ ok: false, error: String(error) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await testJraConnection();
          console.log("JRA scheduled connectivity test", JSON.stringify(result));
        } catch (error) {
          console.error("JRA scheduled connectivity failed", String(error));
        }
      })()
    );
  },
};
