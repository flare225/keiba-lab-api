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

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "keiba-lab/0.6.0 (+race ingestion)", accept: "text/html,*/*;q=0.8" },
    redirect: "follow",
  });
  const body = await response.text();
  return { ok: response.ok, status: response.status, url: response.url, contentType: response.headers.get("content-type"), bytes: body.length, body };
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

function stripHtml(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function scoreRacePage(url, html) {
  const u = url.toLowerCase();
  const text = stripHtml(html).slice(0, 200000);
  let score = 0;
  if (/\/keiba\/race\//.test(u)) score += 4;
  if (/race\/?\d*\.html/.test(u)) score += 3;
  if (/出馬表|馬名|騎手|斤量/.test(text)) score += 5;
  if (/\b1R\b|1レース|第1競走/.test(text)) score += 2;
  if (/施設|競馬場案内|海外競馬/.test(text)) score -= 4;
  return score;
}

async function discoverRacePages() {
  const top = await fetchHtml("https://www.jra.go.jp/");
  if (!top.ok) return { ok: false, stage: "fetch-jra", status: top.status };

  const firstLinks = extractLinks(top.body, top.url);
  const seedUrls = firstLinks.filter((u) => /\/keiba\/|tokubetsu|race/i.test(u)).slice(0, 35);
  const queue = [...seedUrls];
  const visited = new Set();
  const found = [];

  while (queue.length && visited.size < 45) {
    const candidate = queue.shift();
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      const page = await fetchHtml(candidate);
      if (!page.ok || !String(page.contentType || "").includes("text/html")) continue;
      const score = scoreRacePage(page.url, page.body);
      if (score >= 5) found.push({ url: page.url, score, bytes: page.bytes, title: (page.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
      if (visited.size < 25) {
        for (const link of extractLinks(page.body, page.url)) {
          if (/\/keiba\/race\/|race\d*\.html|syutsuba|shutsuba/i.test(link) && !visited.has(link) && queue.length < 80) queue.push(link);
        }
      }
    } catch {}
  }

  const unique = [...new Map(found.map((x) => [x.url, x])).values()].sort((a, b) => b.score - a.score);
  return { ok: true, stage: "race-page-resolution", date: tokyoDate(), source: top.url, scanned: visited.size, racePageCount: unique.length, racePages: unique.slice(0, 30) };
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
  const result = await discoverRacePages();
  return result.ok ? { ...result, next: result.racePageCount ? "Parse resolved race pages into structured races/runners, then persist to D1" : "Inspect JRA navigation pattern and expand resolver" } : result;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type" } });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return json({ ok: true, service: "keiba-lab-api", version: "0.6.0", phase: "JRA race-page resolver", missing: env.DB ? [] : ["D1 binding: DB"] });
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      if (url.pathname === "/health" || url.pathname === "/api/health") {
        const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
        return json({ ok: true, database: "connected", tables: result.results });
      }
      if (url.pathname === "/v1/schema") return json({ ok: true, database: "connected", tableCount: (await inspectSchema(env.DB)).length, tables: await inspectSchema(env.DB) });
      if (url.pathname === "/v1/jra/test") {
        const r = await fetchHtml("https://www.jra.go.jp/");
        return json({ source: "JRA", ok: r.ok, status: r.status, contentType: r.contentType, bytes: r.bytes }, r.ok ? 200 : 502);
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
    } catch (error) { return json({ ok: false, error: String(error), stack: error?.stack || null }, 500); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try { console.log("JRA ingestion", JSON.stringify(await ingestDiscovery(env))); }
      catch (error) { console.error("JRA ingestion failed", String(error)); }
    })());
  },
};
