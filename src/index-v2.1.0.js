import app from "./index-v2.0.0.js";

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
      "user-agent": "keiba-lab/2.1.0 (+coverage audit + workout source validation)",
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

function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const href = new URL(m[1].replace(/&amp;/g, "&"), baseUrl).href;
      if (seen.has(href)) continue;
      seen.add(href);
      const parsed = new URL(href);
      out.push({
        anchorText: text(m[2]),
        href,
        pathname: parsed.pathname,
        cname: parsed.searchParams.get("CNAME") || null,
      });
    } catch {}
  }
  return out;
}

async function safeCount(db, sql, bindings = []) {
  try {
    const row = await db.prepare(sql).bind(...bindings).first();
    return Number(row?.n || 0);
  } catch {
    return 0;
  }
}

async function coverageResponse(url, db) {
  const date = url.searchParams.get("date");
  if (!validDate(date)) throw new Error("date=YYYY-MM-DD is required");

  const racesResult = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count
    FROM jra_races
    WHERE race_date=?
    ORDER BY venue,race_no
  `).bind(date).all();
  const races = racesResult.results || [];
  const output = [];

  for (const race of races) {
    const runnerCount = await safeCount(db,
      `SELECT COUNT(*) AS n FROM jra_runners WHERE race_key=?`,
      [race.race_key]);

    const horsesWithHistory = await safeCount(db,
      `SELECT COUNT(*) AS n
       FROM jra_runners r
       WHERE r.race_key=?
         AND EXISTS (
           SELECT 1 FROM jra_past_performances p
           WHERE p.horse_name=r.horse_name AND p.race_date < ?
         )`,
      [race.race_key, date]);

    const historyRows = await safeCount(db,
      `SELECT COUNT(*) AS n
       FROM jra_past_performances p
       WHERE p.race_date < ?
         AND p.horse_name IN (
           SELECT horse_name FROM jra_runners WHERE race_key=?
         )`,
      [date, race.race_key]);

    const baseSnapshots = await safeCount(db,
      `SELECT COUNT(*) AS n FROM lab_prediction_snapshots WHERE race_key=? AND model_version='1.5.0'`,
      [race.race_key]);
    const paceSnapshots = await safeCount(db,
      `SELECT COUNT(*) AS n FROM lab_pace_style_snapshots WHERE race_key=? AND model_version='1.8.0'`,
      [race.race_key]);
    const integratedSnapshots = await safeCount(db,
      `SELECT COUNT(*) AS n FROM lab_integrated_snapshots WHERE race_key=? AND model_version='1.9.0'`,
      [race.race_key]);

    output.push({
      raceKey: race.race_key,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      surface: race.surface,
      distance: race.distance,
      runnerCount,
      raceCardStored: runnerCount > 0,
      horsesWithHistory,
      historyRows,
      historyCoveragePct: runnerCount ? Math.round((horsesWithHistory / runnerCount) * 1000) / 10 : 0,
      baseSnapshots,
      paceSnapshots,
      integratedSnapshots,
      analysisReady: runnerCount > 0 && horsesWithHistory === runnerCount && integratedSnapshots >= runnerCount,
    });
  }

  const totalRunners = output.reduce((sum, r) => sum + r.runnerCount, 0);
  const raceCardsReady = output.filter((r) => r.raceCardStored).length;
  const historyReadyRaces = output.filter((r) => r.runnerCount > 0 && r.horsesWithHistory === r.runnerCount).length;
  const integratedReadyRaces = output.filter((r) => r.runnerCount > 0 && r.integratedSnapshots >= r.runnerCount).length;

  return {
    ok: true,
    stage: "database-and-analysis-coverage",
    version: "2.1.0",
    date,
    raceCount: output.length,
    totalRunners,
    raceCardsReady,
    historyReadyRaces,
    integratedReadyRaces,
    meaning: {
      raceCardStored: "race + runners are in D1",
      historyCoveragePct: "how many runners already have pre-race history in D1",
      analysisReady: "race card + history + integrated v1.9 snapshots are all present",
    },
    races: output,
  };
}

function classifyWorkoutLink(link) {
  const anchor = String(link.anchorText || "");
  const path = String(link.pathname || "");
  const cname = String(link.cname || "");
  const hasWorkoutWords = /調教タイム|追い切|追切|調教/.test(anchor);
  if (!hasWorkoutWords) return { class: "irrelevant", reason: "no workout wording" };

  if (/\/event\//i.test(path) || /公開調教/.test(anchor)) {
    return { class: "generic", reason: "event/public-workout information, not runner-specific evidence" };
  }
  if (/\/datafile\/meikan\//i.test(path) || /騎手・調教師データ/.test(anchor)) {
    return { class: "generic", reason: "directory/reference page, not race-specific workout data" };
  }

  const raceDbLike = /\/JRADB\//i.test(path) || /^pw01/i.test(cname);
  if (raceDbLike && /調教タイム|追い切|追切/.test(anchor)) {
    return { class: "direct-candidate", reason: "race-database style link with explicit workout wording" };
  }

  return { class: "uncertain", reason: "workout wording found but not yet proven runner/race specific" };
}

async function conditionAudit(url, db) {
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
  if (!race?.source_url) throw new Error("race/source_url not found in D1");

  const page = await fetchHtml(race.source_url);
  if (!page.ok) throw new Error(`race page HTTP ${page.status}`);

  const links = extractLinks(page.body, page.url)
    .map((link) => ({ ...link, audit: classifyWorkoutLink(link) }))
    .filter((x) => x.audit.class !== "irrelevant");

  const direct = links.filter((x) => x.audit.class === "direct-candidate");
  const uncertain = links.filter((x) => x.audit.class === "uncertain");
  const generic = links.filter((x) => x.audit.class === "generic");

  return {
    ok: true,
    stage: "condition-source-audit",
    version: "2.1.0",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
    },
    directWorkoutCandidateCount: direct.length,
    uncertainWorkoutLinkCount: uncertain.length,
    rejectedGenericWorkoutLinkCount: generic.length,
    directWorkoutCandidates: direct,
    uncertainWorkoutLinks: uncertain,
    rejectedGenericWorkoutLinks: generic,
    conditionPrepScoreActivated: false,
    policy: "Generic pages such as public-workout events or trainer/jockey directories are explicitly rejected. The final 10 points stay disabled until race/runner-specific pre-race evidence is proven.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "2.1.0",
        phase: "coverage audit + validated condition-source discovery",
        missing: env.DB ? ["validated runner-specific workout/condition source for final 10 points"] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/coverage") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await coverageResponse(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "2.1.0", error: String(error) }, 500);
      }
    }

    if (url.pathname === "/v1/lab/condition-audit") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await conditionAudit(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "2.1.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
