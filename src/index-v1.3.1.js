import app from "./index-v1.3.0.js";

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
      "user-agent": "keiba-lab/1.3.1 (+profile-link diagnostics)",
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

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function describeLink(href, anchorText, baseUrl) {
  try {
    const url = new URL(href.replace(/&amp;/g, "&"), baseUrl);
    return {
      anchorText,
      href: url.href,
      pathname: url.pathname,
      cname: url.searchParams.get("CNAME") || null,
    };
  } catch {
    return { anchorText, href, pathname: null, cname: null };
  }
}

async function debugProfileLinks(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=1-12 are required");
  }

  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,source_url
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");
  if (!race.source_url) throw new Error("race source_url is missing");

  const runnerResult = await db.prepare(`
    SELECT horse_no,horse_name
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();
  const runners = runnerResult.results || [];
  const wanted = new Set(runners.map((r) => r.horse_name));

  const page = await fetchHtml(race.source_url);
  if (!page.ok) throw new Error(`race page HTTP ${page.status}`);

  const exactNameMatches = [];
  const accessUCandidates = [];
  const dudCandidates = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(page.body))) {
    const anchorText = text(match[2]);
    const link = describeLink(match[1], anchorText, page.url);
    if (wanted.has(anchorText)) exactNameMatches.push(link);
    if (/accessU\.html/i.test(link.pathname || "")) accessUCandidates.push(link);
    if (/pw01dud/i.test(link.cname || "")) dudCandidates.push(link);
  }

  return {
    ok: true,
    stage: "profile-link-diagnostics",
    version: "1.3.1",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      sourceUrl: race.source_url,
    },
    runnerCount: runners.length,
    exactNameMatchCount: exactNameMatches.length,
    accessUCandidateCount: accessUCandidates.length,
    dudCandidateCount: dudCandidates.length,
    exactNameMatches: exactNameMatches.slice(0, 40),
    accessUCandidates: accessUCandidates.slice(0, 40),
    dudCandidates: dudCandidates.slice(0, 40),
    next: "Use the observed pathname/CNAME pattern to relax the profile-link resolver without guessing.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.3.1",
        phase: "JRA horse profile link diagnostics",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/history-debug") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await debugProfileLinks(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.3.1", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
