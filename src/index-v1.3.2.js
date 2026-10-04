import app from "./index-v1.3.1.js";

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
      "user-agent": "keiba-lab/1.3.2 (+JRA profile history diagnostics)",
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

function rowCells(rowHtml) {
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((m) => text(m[1]));
}

function historyCandidates(html) {
  const rows = [];
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = rowCells(m[1]);
    const joined = cells.join(" | ");
    if (!/(20\d{2})[年/.\-]\s*\d{1,2}[月/.\-]\s*\d{1,2}/.test(joined)) continue;
    if (!/(芝|ダート|ダ|障害)\s*[123][0-9]{3}/.test(joined)) continue;
    rows.push({ cellCount: cells.length, cells: cells.slice(0, 24) });
  }
  return rows;
}

async function historyStructureProbe(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=1-12 are required");
  }

  const race = await db.prepare(`SELECT race_key,race_date,venue,race_no,race_name,source_url FROM jra_races WHERE race_date=? AND venue=? AND race_no=?`).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");

  const rr = await db.prepare(`SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no`).bind(race.race_key).all();
  const runners = rr.results || [];

  const racePage = await fetchHtml(race.source_url);
  if (!racePage.ok) throw new Error(`race page HTTP ${racePage.status}`);

  const profileLinks = extractProfileLinks(racePage.body, runners.map((r) => r.horse_name), racePage.url);
  const samples = [];
  let profilesFetched = 0;
  let totalCandidateRows = 0;

  for (const runner of runners.slice(0, 3)) {
    const profileUrl = profileLinks.get(runner.horse_name) || null;
    if (!profileUrl) {
      samples.push({ horseName: runner.horse_name, profileUrl: null, candidateRows: 0, rows: [] });
      continue;
    }
    const page = await fetchHtml(profileUrl);
    if (!page.ok) {
      samples.push({ horseName: runner.horse_name, profileUrl, httpStatus: page.status, candidateRows: 0, rows: [] });
      continue;
    }
    profilesFetched += 1;
    const candidates = historyCandidates(page.body);
    totalCandidateRows += candidates.length;
    samples.push({
      horseName: runner.horse_name,
      profileUrl,
      candidateRows: candidates.length,
      rows: candidates.slice(0, 5),
    });
  }

  return {
    ok: profileLinks.size > 0,
    stage: "profile-history-structure",
    version: "1.3.2",
    race: { raceKey: race.race_key, date: race.race_date, venue: race.venue, raceNo: race.race_no, raceName: race.race_name },
    runnerCount: runners.length,
    profileLinksFound: profileLinks.size,
    profilesFetched,
    sampledProfiles: Math.min(3, runners.length),
    totalCandidateRowsInSamples: totalCandidateRows,
    samples,
    next: "Use observed cell structure to map official past-performance columns safely, then persist with leakage guard.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({ ok: true, service: "keiba-lab-api", version: "1.3.2", phase: "JRA horse history structure probe", missing: env.DB ? [] : ["D1 binding: DB"] });
    }

    if (url.pathname === "/v1/lab/history-structure") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await historyStructureProbe(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.3.2", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
