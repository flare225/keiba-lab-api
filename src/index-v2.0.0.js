import app from "./index-v1.9.0.js";

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
      "user-agent": "keiba-lab/2.0.0 (+condition prep evidence diagnostics)",
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

function conditionLinkScore(link) {
  const anchor = String(link.anchorText || "");
  const haystack = `${anchor} ${link.pathname || ""} ${link.cname || ""}`;
  let score = 0;
  if (/調教タイム|調教/.test(anchor)) score += 10;
  if (/追い切|追切/.test(anchor)) score += 10;
  if (/調教後馬体重/.test(anchor)) score += 12;
  if (/馬体重/.test(anchor)) score += 8;
  if (/状態|気配|厩舎コメント|コメント/.test(anchor)) score += 4;
  if (/chokyo|training|weight/i.test(haystack)) score += 3;
  return score;
}

function findRunnerRow(html, horseName) {
  let best = null;
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1];
    const rowText = text(rowHtml);
    if (!rowText.includes(horseName)) continue;
    const quality = rowText.length;
    if (!best || quality > best.quality) best = { rowHtml, rowText, quality };
  }
  return best;
}

function parseCurrentBodyWeight(rowText) {
  const s = String(rowText || "");
  const m = s.match(/(\d{3})\s*kg\s*[（(]\s*([+＋-－]?\d+)\s*[）)]/i);
  if (!m) return { bodyWeight: null, bodyWeightChange: null };
  const normalized = String(m[2]).replace(/＋/g, "+").replace(/－/g, "-");
  return {
    bodyWeight: Number(m[1]),
    bodyWeightChange: Number(normalized),
  };
}

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function summarizePrep(history, runner, raceDate, currentBody) {
  const latest = history[0] || null;
  const daysSinceLastRun = latest ? daysBetween(latest.race_date, raceDate) : null;
  const historyWeightChanges = history
    .map((r) => Number(r.body_weight_change))
    .filter((v) => Number.isFinite(v));
  const absWeightChanges = historyWeightChanges.map((v) => Math.abs(v));
  const avgAbsHistoricalWeightChange = absWeightChanges.length
    ? round1(absWeightChanges.reduce((a, b) => a + b, 0) / absWeightChanges.length)
    : null;
  const latestAssigned = latest?.assigned_weight == null ? null : Number(latest.assigned_weight);
  const currentAssigned = runner.assigned_weight == null ? null : Number(runner.assigned_weight);
  const assignedWeightDelta = Number.isFinite(latestAssigned) && Number.isFinite(currentAssigned)
    ? round1(currentAssigned - latestAssigned)
    : null;

  let freshnessBucket = "unknown";
  if (daysSinceLastRun != null) {
    if (daysSinceLastRun <= 14) freshnessBucket = "short-turnaround";
    else if (daysSinceLastRun <= 42) freshnessBucket = "standard";
    else if (daysSinceLastRun <= 90) freshnessBucket = "fresh";
    else freshnessBucket = "long-layoff";
  }

  const signalsAvailable = [
    daysSinceLastRun != null,
    currentBody.bodyWeight != null,
    currentBody.bodyWeightChange != null,
    avgAbsHistoricalWeightChange != null,
    assignedWeightDelta != null,
  ].filter(Boolean).length;

  return {
    latestPriorRaceDate: latest?.race_date || null,
    daysSinceLastRun,
    freshnessBucket,
    currentBodyWeight: currentBody.bodyWeight,
    currentBodyWeightChange: currentBody.bodyWeightChange,
    avgAbsHistoricalWeightChange,
    currentAssignedWeight: currentAssigned,
    previousAssignedWeight: latestAssigned,
    assignedWeightDelta,
    signalsAvailable,
    status: signalsAvailable >= 4 ? "useful-proxy-evidence" : signalsAvailable >= 2 ? "partial-proxy-evidence" : "thin-proxy-evidence",
  };
}

async function resolveRace(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=1-12 are required");
  }

  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count,source_url
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");
  if (!race.source_url) throw new Error("race source_url is missing");

  const rr = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,jockey,trainer,assigned_weight
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return { race, runners: rr.results || [] };
}

async function loadHistory(db, horseName, beforeDate) {
  const result = await db.prepare(`
    SELECT race_date,assigned_weight,body_weight,body_weight_change,track_condition
    FROM jra_past_performances
    WHERE horse_name=? AND race_date < ?
    ORDER BY race_date DESC
    LIMIT 5
  `).bind(horseName, beforeDate).all();
  return result.results || [];
}

async function conditionDebug(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const sampleSize = Math.max(1, Math.min(runners.length, Number(url.searchParams.get("sample") || 5)));
  const racePage = await fetchHtml(race.source_url);
  if (!racePage.ok) throw new Error(`race page HTTP ${racePage.status}`);

  const links = extractLinks(racePage.body, racePage.url)
    .map((link) => ({ ...link, score: conditionLinkScore(link) }))
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score);

  const workoutLinks = links.filter((l) => /調教|追い切|追切/.test(l.anchorText || ""));
  const bodyWeightLinks = links.filter((l) => /馬体重/.test(l.anchorText || ""));

  const samples = [];
  for (const runner of runners.slice(0, sampleSize)) {
    const row = findRunnerRow(racePage.body, runner.horse_name);
    const currentBody = parseCurrentBodyWeight(row?.rowText || "");
    const history = await loadHistory(db, runner.horse_name, race.race_date);
    samples.push({
      horseNo: runner.horse_no,
      horseName: runner.horse_name,
      trainer: runner.trainer,
      jockey: runner.jockey,
      rowFound: Boolean(row),
      prepProxy: summarizePrep(history, runner, race.race_date, currentBody),
      rowTextSample: row?.rowText ? row.rowText.slice(0, 360) : null,
    });
  }

  return {
    ok: true,
    stage: "condition-prep-source-diagnostics",
    version: "2.0.0",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      surface: race.surface,
      distance: race.distance,
      runnerCount: runners.length,
    },
    racePageFetched: true,
    candidateConditionLinks: links.length,
    workoutLinkCount: workoutLinks.length,
    bodyWeightLinkCount: bodyWeightLinks.length,
    topConditionLinks: links.slice(0, 20),
    sampledRunners: samples.length,
    samples,
    conditionPrepScoreActivated: false,
    policy: "Body weight, layoff and assigned-weight changes are retained only as proxy evidence. The final 10-point conditionPrep block stays disabled until a real pre-race workout/condition source is resolved; proxies are not treated as workout quality.",
    leakageGuard: `All historical prep proxies use races strictly before ${race.race_date}.`,
    next: workoutLinks.length
      ? "Map the discovered workout/condition page structure and persist workout evidence, then activate the final 10-point block."
      : "No direct workout link was resolved from this race page. Inspect topConditionLinks/body-weight evidence and add a dedicated official workout source or explicit manual input before activating the final 10 points.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "2.0.0",
        phase: "condition/prep source diagnostics",
        missing: env.DB ? ["validated workout/condition source for final 10 points"] : ["D1 binding: DB", "validated workout/condition source for final 10 points"],
      });
    }

    if (url.pathname === "/v1/lab/condition-debug") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await conditionDebug(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "2.0.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
