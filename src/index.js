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
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function fetchJraTop() {
  const startedAt = new Date().toISOString();
  const response = await fetch("https://www.jra.go.jp/", {
    headers: { "user-agent": "keiba-lab/0.5.0 (+race ingestion)", accept: "text/html,*/*;q=0.8" },
    redirect: "follow",
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, url: response.url, contentType: response.headers.get("content-type"), bytes: body.length, body, startedAt, finishedAt: new Date().toISOString() };
}

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1], baseUrl).href;
      if (!url.startsWith("https://www.jra.go.jp/")) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      links.push(url);
    } catch {}
  }
  return links;
}

function candidateRaceLinks(links) {
  const words = ["race", "syutsuba", "shutsuba", "kaisai", "tokubetsu", "jra.html"];
  return links.filter((url) => words.some((word) => url.toLowerCase().includes(word))).slice(0, 80);
}

async function inspectSchema(db) {
  const tablesResult = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all();
  const tables = [];
  for (const row of tablesResult.results || []) {
    const tableName = String(row.name);
    if (!/^[A-Za-z0-9_]+$/.test(tableName)) continue;
    const columnsResult = await db.prepare(`PRAGMA table_info(${tableName})`).all();
    tables.push({ name: tableName, columns: columnsResult.results || [] });
  }
  return tables;
}

async function ingestDiscovery(env) {
  const top = await fetchJraTop();
  if (!top.ok) return { ok: false, stage: "fetch-jra", status: top.status };
  const allLinks = extractLinks(top.body, top.url);
  const candidates = candidateRaceLinks(allLinks);
  return {
    ok: true,
    stage: "discovery",
    date: tokyoDate(),
    source: top.url,
    bytes: top.bytes,
    linkCount: allLinks.length,
    candidateCount: candidates.length,
    candidates,
    next: "Resolve current JRA race-card pages, parse races, then map to D1 races columns",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type" } });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return json({ ok: true, service: "keiba-lab-api", version: "0.5.0", phase: "JRA ingestion", missing: env.DB ? [] : ["D1 binding: DB"] });
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
        const r = await fetchJraTop();
        return json({ source: "JRA", ok: r.ok, status: r.status, contentType: r.contentType, bytes: r.bytes, startedAt: r.startedAt, finishedAt: r.finishedAt }, r.ok ? 200 : 502);
      }
      if (url.pathname === "/v1/jra/discover" || url.pathname === "/v1/jra/ingest") {
        const result = await ingestDiscovery(env);
        return json(result, result.ok ? 200 : 502);
      }
      if (url.pathname === "/v1/meetings/today") {
        const date = tokyoDate();
        const result = await env.DB.prepare("SELECT venue, race_date, COUNT(*) AS race_count FROM races WHERE race_date = ? GROUP BY venue, race_date ORDER BY venue").bind(date).all();
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
    } catch (error) { return json({ ok: false, error: String(error) }, 500); }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const result = await ingestDiscovery(env);
        console.log("JRA ingestion discovery", JSON.stringify(result));
      } catch (error) { console.error("JRA ingestion discovery failed", String(error)); }
    })());
  },
};
