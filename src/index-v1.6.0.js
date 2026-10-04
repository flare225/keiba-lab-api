import app from "./index-v1.5.0.js";

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
      "user-agent": "keiba-lab/1.6.0 (+pace-style source diagnostics)",
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

function rowCells(rowHtml) {
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((m) => text(m[1]));
}

function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1].replace(/&amp;/g, "&"), baseUrl).href;
      if (seen.has(url)) continue;
      seen.add(url);
      const parsed = new URL(url);
      out.push({
        anchorText: text(m[2]),
        href: url,
        pathname: parsed.pathname,
        cname: parsed.searchParams.get("CNAME") || null,
      });
    } catch {}
  }
  return out;
}

function jpDate(iso) {
  const [y, m, d] = String(iso || "").split("-");
  if (!y || !m || !d) return null;
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

function findHistoryRow(profileHtml, raceDate, raceName) {
  const dateText = jpDate(raceDate);
  let loose = null;
  for (const match of profileHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1];
    const rowText = text(rowHtml);
    if (!rowText) continue;
    const dateHit = dateText && rowText.includes(dateText);
    const raceHit = raceName && rowText.includes(raceName);
    if (dateHit && raceHit) return { rowHtml, rowText, exact: true };
    if (!loose && (dateHit || raceHit)) loose = { rowHtml, rowText, exact: false };
  }
  return loose;
}

function scoreResultLink(link) {
  const path = link.pathname || "";
  const cname = link.cname || "";
  let score = 0;
  if (/\/JRADB\/accessS\.html/i.test(path)) score += 8;
  if (/\/JRADB\/accessD\.html/i.test(path)) score += 3;
  if (/^pw01sde/i.test(cname)) score += 10;
  if (/^pw01dde/i.test(cname)) score += 2;
  if (/race|結果|成績/.test(link.anchorText || "")) score += 1;
  return score;
}

function findHorseRow(resultHtml, horseName) {
  for (const match of resultHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1];
    const rowText = text(rowHtml);
    if (!rowText.includes(horseName)) continue;
    const cells = rowCells(rowHtml);
    if (cells.length < 5) continue;
    return { rowText, cells };
  }
  return null;
}

function cornerCandidates(cells, rowText) {
  const candidates = [];
  const push = (value, source) => {
    const s = String(value || "").trim();
    if (!s) return;
    if (/^(?:\d{1,2})(?:\s*[-－–]\s*\d{1,2}){1,4}$/.test(s)) candidates.push({ value: s, source });
    else if (/^(?:\d{1,2}\s+){1,4}\d{1,2}$/.test(s)) candidates.push({ value: s, source });
    else if (/通過|コーナー/.test(s) && /\d/.test(s)) candidates.push({ value: s, source });
  };
  cells.forEach((cell, index) => push(cell, `cell:${index}`));
  const inline = String(rowText || "").match(/(?:^|\s)(\d{1,2}(?:[-－–]\d{1,2}){1,4})(?:\s|$)/g) || [];
  inline.forEach((value) => push(value.trim(), "rowText"));
  return candidates;
}

async function resolveRace(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=1-12 are required");
  }
  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count
    FROM jra_races WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");
  const runners = await db.prepare(`
    SELECT horse_no,horse_name FROM jra_runners WHERE race_key=? ORDER BY horse_no
  `).bind(race.race_key).all();
  return { race, runners: runners.results || [] };
}

async function styleDebug(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const sampleSize = Math.max(1, Math.min(5, Number(url.searchParams.get("sample") || 3)));
  const sampled = runners.slice(0, sampleSize);
  const samples = [];
  let profilePagesFetched = 0;
  let historyRowsMatched = 0;
  let resultLinksResolved = 0;
  let resultPagesFetched = 0;
  let horseRowsFound = 0;
  let samplesWithCornerCandidate = 0;

  for (const runner of sampled) {
    const perf = await db.prepare(`
      SELECT horse_name,race_date,venue,race_name,source_url
      FROM jra_past_performances
      WHERE horse_name=? AND race_date < ?
      ORDER BY race_date DESC LIMIT 1
    `).bind(runner.horse_name, race.race_date).first();

    if (!perf?.source_url) {
      samples.push({ horseNo: runner.horse_no, horseName: runner.horse_name, status: "no-history-source" });
      continue;
    }

    const profile = await fetchHtml(perf.source_url);
    if (!profile.ok) {
      samples.push({ horseNo: runner.horse_no, horseName: runner.horse_name, status: "profile-fetch-failed", httpStatus: profile.status });
      continue;
    }
    profilePagesFetched += 1;

    const historyRow = findHistoryRow(profile.body, perf.race_date, perf.race_name);
    if (!historyRow) {
      samples.push({ horseNo: runner.horse_no, horseName: runner.horse_name, status: "history-row-not-found", priorRace: perf });
      continue;
    }
    historyRowsMatched += 1;

    const rowLinks = extractLinks(historyRow.rowHtml, profile.url)
      .map((link) => ({ ...link, score: scoreResultLink(link) }))
      .sort((a, b) => b.score - a.score);
    const resultLink = rowLinks.find((link) => link.score > 0) || null;

    if (!resultLink) {
      samples.push({
        horseNo: runner.horse_no,
        horseName: runner.horse_name,
        status: "result-link-not-found",
        priorRace: { raceDate: perf.race_date, venue: perf.venue, raceName: perf.race_name },
        historyRowExactMatch: historyRow.exact,
        rowLinks: rowLinks.slice(0, 12),
      });
      continue;
    }
    resultLinksResolved += 1;

    const resultPage = await fetchHtml(resultLink.href);
    if (!resultPage.ok) {
      samples.push({
        horseNo: runner.horse_no,
        horseName: runner.horse_name,
        status: "result-fetch-failed",
        resultLink,
        httpStatus: resultPage.status,
      });
      continue;
    }
    resultPagesFetched += 1;

    const horseRow = findHorseRow(resultPage.body, runner.horse_name);
    if (!horseRow) {
      samples.push({
        horseNo: runner.horse_no,
        horseName: runner.horse_name,
        status: "horse-row-not-found-in-result",
        resultLink,
      });
      continue;
    }
    horseRowsFound += 1;
    const candidates = cornerCandidates(horseRow.cells, horseRow.rowText);
    if (candidates.length) samplesWithCornerCandidate += 1;

    samples.push({
      horseNo: runner.horse_no,
      horseName: runner.horse_name,
      status: "inspected",
      priorRace: { raceDate: perf.race_date, venue: perf.venue, raceName: perf.race_name },
      historyRowExactMatch: historyRow.exact,
      resultLink,
      resultHorseRowCellCount: horseRow.cells.length,
      resultHorseRowCells: horseRow.cells.slice(0, 24),
      cornerCandidates: candidates,
    });
  }

  return {
    ok: true,
    stage: "pace-style-source-diagnostics",
    version: "1.6.0",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      runnerCount: runners.length,
    },
    sampleSize: sampled.length,
    profilePagesFetched,
    historyRowsMatched,
    resultLinksResolved,
    resultPagesFetched,
    horseRowsFound,
    samplesWithCornerCandidate,
    samples,
    next: "Map the observed result-row corner-position field, persist running-style evidence, then activate paceStyleFit without guessing.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.6.0",
        phase: "pace/style evidence acquisition",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/style-debug") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await styleDebug(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.6.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
