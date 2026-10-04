import app from "./index-v1.7.0.js";

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
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
      "user-agent": "keiba-lab/1.8.0 (+pace style fit + track bias)",
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
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((m) => text(m[1]));
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
    if (dateHit && raceHit) return { rowHtml, exact: true };
    if (!loose && (dateHit || raceHit)) loose = { rowHtml, exact: false };
  }
  return loose;
}

function scoreResultLink(link, raceName) {
  const path = link.pathname || "";
  const cname = link.cname || "";
  const anchor = link.anchorText || "";
  let score = 0;
  if (/\/JRADB\/accessS\.html/i.test(path)) score += 10;
  if (/^pw01sde/i.test(cname)) score += 12;
  if (/\/JRADB\/accessD\.html/i.test(path)) score += 2;
  if (/^pw01dde/i.test(cname)) score += 2;
  if (/レース結果|結果|成績/.test(anchor)) score += 5;
  if (raceName && anchor.includes(raceName)) score += 3;
  return score;
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

function parseFinalCorner(candidates, fieldSize) {
  for (const candidate of candidates) {
    const nums = String(candidate.value || "").match(/\d{1,2}/g) || [];
    if (nums.length < 2) continue;
    const value = Number(nums[nums.length - 1]);
    if (Number.isInteger(value) && value >= 1 && value <= Math.max(30, Number(fieldSize || 0))) {
      return { value, raw: candidate.value, source: candidate.source };
    }
  }
  return null;
}

function findHorseRow(resultHtml, horseName, fieldSize) {
  let best = null;
  for (const match of resultHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1];
    const rowText = text(rowHtml);
    if (!rowText.includes(horseName)) continue;
    const cells = rowCells(rowHtml);
    if (cells.length < 5) continue;
    const finalCorner = parseFinalCorner(cornerCandidates(cells, rowText), fieldSize);
    const quality = cells.length + (finalCorner ? 30 : 0);
    if (!best || quality > best.quality) {
      best = {
        finalCorner: finalCorner?.value ?? null,
        cornerRaw: finalCorner?.raw ?? null,
        cornerSource: finalCorner?.source ?? null,
        cellCount: cells.length,
        quality,
      };
    }
  }
  return best;
}

function classifyStyle(finalCorner, fieldSize) {
  const corner = Number(finalCorner);
  const field = Number(fieldSize);
  if (!Number.isInteger(corner) || !Number.isInteger(field) || field < 2) return null;
  const pct = clamp((corner - 1) / (field - 1), 0, 1);
  if (pct <= 0.10) return { key: "leader", label: "逃げ", cornerPercentile: round1(pct * 100) };
  if (pct <= 0.30) return { key: "front", label: "先行", cornerPercentile: round1(pct * 100) };
  if (pct <= 0.65) return { key: "stalker", label: "差し", cornerPercentile: round1(pct * 100) };
  return { key: "closer", label: "追込", cornerPercentile: round1(pct * 100) };
}

function basePaceFit(styleKey, paceBias) {
  const neutral = { leader: 72, front: 72, stalker: 72, closer: 72 };
  const front = { leader: 92, front: 86, stalker: 60, closer: 42 };
  const closer = { leader: 43, front: 56, stalker: 86, closer: 92 };
  if (paceBias === "front-favoring") return front[styleKey] ?? 60;
  if (paceBias === "closer-favoring") return closer[styleKey] ?? 60;
  return neutral[styleKey] ?? 60;
}

function laneAdjustment(frameNo, maxFrame, laneBias) {
  const frame = Number(frameNo);
  const max = Number(maxFrame);
  if (!Number.isInteger(frame) || !Number.isInteger(max) || max < 2) return 0;
  const pct = (frame - 1) / (max - 1);
  if (laneBias === "inside-favoring") return pct <= 0.40 ? 6 : pct >= 0.60 ? -6 : 0;
  if (laneBias === "outside-favoring") return pct >= 0.60 ? 6 : pct <= 0.40 ? -6 : 0;
  return 0;
}

function confidenceFactor(biasConfidence) {
  if (biasConfidence === "high") return 0.72;
  if (biasConfidence === "medium") return 0.58;
  return 0.42;
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
  const rr = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,jockey,trainer,assigned_weight
    FROM jra_runners WHERE race_key=? ORDER BY horse_no
  `).bind(race.race_key).all();
  return { race, runners: rr.results || [] };
}

async function latestPriorRun(db, horseName, beforeDate) {
  return db.prepare(`
    SELECT horse_name,race_date,venue,race_name,field_size,source_url
    FROM jra_past_performances
    WHERE horse_name=? AND race_date < ?
    ORDER BY race_date DESC LIMIT 1
  `).bind(horseName, beforeDate).first();
}

async function loadBias(db, raceKey) {
  try {
    const row = await db.prepare(`
      SELECT model_version,prior_races_found,analyzed_races,top3_corner_samples,
             front_top3_rate_pct,back_top3_rate_pct,avg_top3_final_corner_pct,
             avg_top3_frame_pct,pace_bias,lane_bias,confidence,generated_at
      FROM lab_track_bias_snapshots
      WHERE race_key=?
      ORDER BY generated_at DESC LIMIT 1
    `).bind(raceKey).first();
    return row || null;
  } catch {
    return null;
  }
}

async function ensureStyleTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_pace_style_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    style_key TEXT,
    style_label TEXT,
    source_race_date TEXT,
    source_race_name TEXT,
    final_corner INTEGER,
    source_field_size INTEGER,
    corner_percentile REAL,
    pace_bias TEXT,
    lane_bias TEXT,
    bias_confidence TEXT,
    raw_fit_score REAL,
    pace_style_fit_score REAL,
    evidence_confidence TEXT,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key, horse_no, model_version)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_pace_style_race ON lab_pace_style_snapshots(race_key, model_version, horse_no)").run();
}

async function inspectRunner(runner, race, bias, maxFrame) {
  const perf = await latestPriorRun(race.db, runner.horse_name, race.race_date);
  if (!perf?.source_url) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "no-history-source" };
  }

  const profile = await fetchHtml(perf.source_url);
  if (!profile.ok) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "profile-fetch-failed", httpStatus: profile.status };
  }

  const historyRow = findHistoryRow(profile.body, perf.race_date, perf.race_name);
  if (!historyRow) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "history-row-not-found", sourceRaceDate: perf.race_date, sourceRaceName: perf.race_name };
  }

  const links = extractLinks(historyRow.rowHtml, profile.url)
    .map((link) => ({ ...link, score: scoreResultLink(link, perf.race_name) }))
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score);
  const resultLink = links[0] || null;
  if (!resultLink) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "result-link-not-found", sourceRaceDate: perf.race_date, sourceRaceName: perf.race_name };
  }

  const resultPage = await fetchHtml(resultLink.href);
  if (!resultPage.ok) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "result-fetch-failed", httpStatus: resultPage.status };
  }

  const fieldSize = Number(perf.field_size || 0);
  const horseRow = findHorseRow(resultPage.body, runner.horse_name, fieldSize);
  if (!horseRow?.finalCorner) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "corner-not-found", sourceRaceDate: perf.race_date, sourceRaceName: perf.race_name };
  }

  const style = classifyStyle(horseRow.finalCorner, fieldSize);
  if (!style) {
    return { horseNo: runner.horse_no, frameNo: runner.frame_no, horseName: runner.horse_name, status: "style-not-classified" };
  }

  const paceBias = bias?.pace_bias || "insufficient-data";
  const laneBias = bias?.lane_bias || "insufficient-data";
  const biasConfidence = bias?.confidence || "low";
  const raw = clamp(basePaceFit(style.key, paceBias) + laneAdjustment(runner.frame_no, maxFrame, laneBias), 0, 100);
  const reliability = confidenceFactor(biasConfidence);
  const shrunk = round1(50 + (raw - 50) * reliability);

  return {
    horseNo: runner.horse_no,
    frameNo: runner.frame_no,
    horseName: runner.horse_name,
    jockey: runner.jockey,
    trainer: runner.trainer,
    assignedWeight: runner.assigned_weight,
    status: "scored",
    sourceRaceDate: perf.race_date,
    sourceRaceName: perf.race_name,
    sourceFieldSize: fieldSize,
    finalCorner: horseRow.finalCorner,
    cornerRaw: horseRow.cornerRaw,
    styleKey: style.key,
    styleLabel: style.label,
    cornerPercentile: style.cornerPercentile,
    paceBias,
    laneBias,
    biasConfidence,
    rawFitScore: raw,
    paceStyleFitScore: shrunk,
    evidenceConfidence: "single-run-style-evidence",
  };
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

async function persistStyle(db, race, rows) {
  await ensureStyleTable(db);
  const generatedAt = new Date().toISOString();
  const scored = rows.filter((r) => r.status === "scored");
  if (!scored.length) return 0;
  const statements = scored.map((r) => db.prepare(`
    INSERT INTO lab_pace_style_snapshots
      (race_key,horse_no,horse_name,model_version,style_key,style_label,source_race_date,source_race_name,final_corner,source_field_size,corner_percentile,pace_bias,lane_bias,bias_confidence,raw_fit_score,pace_style_fit_score,evidence_confidence,generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_key,horse_no,model_version) DO UPDATE SET
      horse_name=excluded.horse_name,
      style_key=excluded.style_key,
      style_label=excluded.style_label,
      source_race_date=excluded.source_race_date,
      source_race_name=excluded.source_race_name,
      final_corner=excluded.final_corner,
      source_field_size=excluded.source_field_size,
      corner_percentile=excluded.corner_percentile,
      pace_bias=excluded.pace_bias,
      lane_bias=excluded.lane_bias,
      bias_confidence=excluded.bias_confidence,
      raw_fit_score=excluded.raw_fit_score,
      pace_style_fit_score=excluded.pace_style_fit_score,
      evidence_confidence=excluded.evidence_confidence,
      generated_at=excluded.generated_at
  `).bind(
    race.race_key,r.horseNo,r.horseName,"1.8.0",r.styleKey,r.styleLabel,r.sourceRaceDate,r.sourceRaceName,
    r.finalCorner,r.sourceFieldSize,r.cornerPercentile,r.paceBias,r.laneBias,r.biasConfidence,r.rawFitScore,r.paceStyleFitScore,r.evidenceConfidence,generatedAt
  ));
  await db.batch(statements);
  return statements.length;
}

async function paceStyleResponse(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const bias = await loadBias(db, race.race_key);
  const maxFrame = Math.max(0, ...runners.map((r) => Number(r.frame_no || 0)));
  const raceContext = { ...race, db };
  const rows = await mapLimit(runners, 4, (runner) => inspectRunner(runner, raceContext, bias, maxFrame));
  rows.sort((a, b) => {
    const av = a.paceStyleFitScore ?? -1;
    const bv = b.paceStyleFitScore ?? -1;
    return bv - av || Number(a.horseNo || 99) - Number(b.horseNo || 99);
  });
  rows.forEach((r, i) => { if (r.status === "scored") r.paceStyleRank = i + 1; });

  const scoredCount = rows.filter((r) => r.status === "scored").length;
  const persist = url.searchParams.get("persist") === "1";
  const persisted = persist ? await persistStyle(db, race, rows) : 0;

  return {
    ok: scoredCount > 0,
    stage: "pace-style-fit-with-track-bias",
    version: "1.8.0",
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
    leakageGuard: `Style evidence uses only each horse's latest race before ${race.race_date}; same-day bias snapshot also excludes the target/future races.`,
    bias: bias ? {
      sourceModelVersion: bias.model_version,
      priorRacesFound: bias.prior_races_found,
      analyzedRaces: bias.analyzed_races,
      top3CornerSamples: bias.top3_corner_samples,
      paceBias: bias.pace_bias,
      laneBias: bias.lane_bias,
      confidence: bias.confidence,
    } : {
      status: "missing-track-bias-snapshot",
      next: "Run /v1/lab/track-bias?...&persist=1 first for stronger pace-style fit.",
    },
    styleEvidencePolicy: "v1.8.0 deliberately uses one latest prior run per horse to stay below Worker subrequest limits. Scores are shrunk toward neutral according to track-bias confidence; they are not treated as full multi-run style certainty.",
    scoredRunners: scoredCount,
    coveragePct: runners.length ? round1((scoredCount / runners.length) * 100) : 0,
    persistedSnapshots: persisted,
    targetWeightInFinalModel: 20,
    runners: rows,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.8.0",
        phase: "pace/style fit integrated with same-day track bias",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/pace-style") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        const result = await paceStyleResponse(url, env.DB);
        return json(result, result.ok ? 200 : 502);
      } catch (error) {
        return json({ ok: false, version: "1.8.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
