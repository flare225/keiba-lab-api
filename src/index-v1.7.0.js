import app from "./index-v1.6.0.js";

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

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "keiba-lab/1.7.0 (+same-day track bias engine)",
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
    if (/^(?:\d{1,2})(?:\s*[-－–]\s*\d{1,2}){1,4}$/.test(s)) {
      candidates.push({ value: s, source });
    } else if (/^(?:\d{1,2}\s+){1,4}\d{1,2}$/.test(s)) {
      candidates.push({ value: s, source });
    } else if (/通過|コーナー/.test(s) && /\d/.test(s)) {
      candidates.push({ value: s, source });
    }
  };
  cells.forEach((cell, index) => push(cell, `cell:${index}`));
  const inline = String(rowText || "").match(/(?:^|\s)(\d{1,2}(?:[-－–]\d{1,2}){1,4})(?:\s|$)/g) || [];
  inline.forEach((value) => push(value.trim(), "rowText"));
  return candidates;
}

function parseFinalCorner(candidates) {
  for (const candidate of candidates) {
    const nums = String(candidate.value || "").match(/\d{1,2}/g) || [];
    if (nums.length < 2) continue;
    const value = Number(nums[nums.length - 1]);
    if (Number.isInteger(value) && value >= 1 && value <= 30) {
      return { value, raw: candidate.value, source: candidate.source };
    }
  }
  return null;
}

function parseFinishPosition(cells, fieldSize) {
  for (let i = 0; i < Math.min(3, cells.length); i++) {
    const s = String(cells[i] || "").trim();
    if (!/^\d{1,2}$/.test(s)) continue;
    const n = Number(s);
    if (n >= 1 && n <= fieldSize) return n;
  }
  return null;
}

function pickHorseRows(resultHtml, runnerMap, fieldSize) {
  const found = new Map();
  for (const match of resultHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = match[1];
    const rowText = text(rowHtml);
    if (!rowText) continue;
    const runner = [...runnerMap.values()].find((r) => rowText.includes(r.horse_name));
    if (!runner) continue;
    const cells = rowCells(rowHtml);
    if (cells.length < 5) continue;
    const corners = cornerCandidates(cells, rowText);
    const finalCorner = parseFinalCorner(corners);
    const finishPosition = parseFinishPosition(cells, fieldSize);
    const quality = cells.length + (finishPosition != null ? 20 : 0) + (finalCorner ? 20 : 0);
    const previous = found.get(runner.horse_name);
    if (!previous || quality > previous.quality) {
      found.set(runner.horse_name, {
        horseName: runner.horse_name,
        horseNo: runner.horse_no,
        frameNo: runner.frame_no,
        finishPosition,
        finalCorner: finalCorner?.value ?? null,
        cornerRaw: finalCorner?.raw ?? null,
        rowCellCount: cells.length,
        quality,
      });
    }
  }
  return [...found.values()];
}

async function resolveTargetRace(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 2 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, and race_no=2-12 are required");
  }
  const race = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("target race not found in D1");
  return race;
}

async function priorRaces(db, target) {
  const result = await db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url,runner_count
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no < ? AND surface=?
    ORDER BY race_no
  `).bind(target.race_date, target.venue, target.race_no, target.surface).all();
  return result.results || [];
}

async function analyzePriorRace(db, race) {
  const runnerResult = await db.prepare(`
    SELECT horse_no,frame_no,horse_name
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();
  const runners = runnerResult.results || [];
  const runnerMap = new Map(runners.map((r) => [r.horse_name, r]));
  const fieldSize = runners.length || Number(race.runner_count || 0);
  const maxFrame = Math.max(0, ...runners.map((r) => Number(r.frame_no || 0)));

  if (!race.source_url || !fieldSize) {
    return { ok: false, raceNo: race.race_no, raceName: race.race_name, reason: "missing source_url or runners" };
  }

  const entryPage = await fetchHtml(race.source_url);
  if (!entryPage.ok) {
    return { ok: false, raceNo: race.race_no, raceName: race.race_name, reason: `entry HTTP ${entryPage.status}` };
  }

  const links = extractLinks(entryPage.body, entryPage.url)
    .map((link) => ({ ...link, score: scoreResultLink(link, race.race_name) }))
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score);
  const resultLink = links[0] || null;
  if (!resultLink) {
    return { ok: false, raceNo: race.race_no, raceName: race.race_name, reason: "result link not found", candidates: links.slice(0, 5) };
  }

  const resultPage = await fetchHtml(resultLink.href);
  if (!resultPage.ok) {
    return { ok: false, raceNo: race.race_no, raceName: race.race_name, reason: `result HTTP ${resultPage.status}`, resultLink: resultLink.href };
  }

  const horseRows = pickHorseRows(resultPage.body, runnerMap, fieldSize);
  const usable = horseRows.filter((r) => r.finishPosition != null);
  const top3 = usable.filter((r) => r.finishPosition <= 3);
  const top3WithCorner = top3.filter((r) => Number.isInteger(r.finalCorner));
  const top3WithFrame = top3.filter((r) => Number.isInteger(Number(r.frameNo)) && maxFrame > 1);

  const frontCutoff = Math.max(3, Math.ceil(fieldSize * 0.25));
  const backCutoff = Math.ceil(fieldSize * 0.6);
  const frontTop3 = top3WithCorner.filter((r) => r.finalCorner <= frontCutoff).length;
  const backTop3 = top3WithCorner.filter((r) => r.finalCorner >= backCutoff).length;

  const cornerPct = top3WithCorner.map((r) => fieldSize > 1 ? ((r.finalCorner - 1) / (fieldSize - 1)) * 100 : 0);
  const framePct = top3WithFrame.map((r) => ((Number(r.frameNo) - 1) / (maxFrame - 1)) * 100);

  return {
    ok: top3.length > 0,
    raceNo: race.race_no,
    raceName: race.race_name,
    surface: race.surface,
    distance: race.distance,
    fieldSize,
    resultLink: resultLink.href,
    matchedHorseRows: horseRows.length,
    top3Matched: top3.length,
    top3WithCorner: top3WithCorner.length,
    frontTop3,
    backTop3,
    avgTop3FinalCornerPct: cornerPct.length ? round1(average(cornerPct)) : null,
    avgTop3FramePct: framePct.length ? round1(average(framePct)) : null,
    top3: top3.map((r) => ({
      finishPosition: r.finishPosition,
      horseName: r.horseName,
      horseNo: r.horseNo,
      frameNo: r.frameNo,
      finalCorner: r.finalCorner,
      cornerRaw: r.cornerRaw,
    })),
  };
}

function aggregateBias(races) {
  const analyzed = races.filter((r) => r.ok);
  const withCorners = analyzed.filter((r) => r.top3WithCorner > 0);
  const withFrames = analyzed.filter((r) => r.avgTop3FramePct != null);
  const top3CornerSamples = withCorners.reduce((sum, r) => sum + r.top3WithCorner, 0);
  const frontTop3 = withCorners.reduce((sum, r) => sum + r.frontTop3, 0);
  const backTop3 = withCorners.reduce((sum, r) => sum + r.backTop3, 0);
  const avgCornerPct = withCorners.length ? average(withCorners.map((r) => r.avgTop3FinalCornerPct)) : null;
  const avgFramePct = withFrames.length ? average(withFrames.map((r) => r.avgTop3FramePct)) : null;
  const frontRate = top3CornerSamples ? frontTop3 / top3CornerSamples : null;
  const backRate = top3CornerSamples ? backTop3 / top3CornerSamples : null;

  let paceBias = "insufficient-data";
  if (top3CornerSamples >= 3 && avgCornerPct != null) {
    if ((frontRate ?? 0) >= 0.6 || avgCornerPct <= 30) paceBias = "front-favoring";
    else if ((backRate ?? 0) >= 0.4 || avgCornerPct >= 55) paceBias = "closer-favoring";
    else paceBias = "neutral";
  }

  let laneBias = "insufficient-data";
  if (withFrames.length >= 2 && avgFramePct != null) {
    if (avgFramePct <= 38) laneBias = "inside-favoring";
    else if (avgFramePct >= 62) laneBias = "outside-favoring";
    else laneBias = "neutral";
  }

  let confidence = "low";
  if (analyzed.length >= 5 && top3CornerSamples >= 12) confidence = "high";
  else if (analyzed.length >= 3 && top3CornerSamples >= 7) confidence = "medium";

  return {
    analyzedRaceCount: analyzed.length,
    top3CornerSamples,
    frontTop3RatePct: frontRate == null ? null : round1(frontRate * 100),
    backTop3RatePct: backRate == null ? null : round1(backRate * 100),
    avgTop3FinalCornerPct: avgCornerPct == null ? null : round1(avgCornerPct),
    avgTop3FramePct: avgFramePct == null ? null : round1(avgFramePct),
    paceBias,
    laneBias,
    confidence,
  };
}

async function ensureBiasTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_track_bias_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    model_version TEXT NOT NULL,
    source_surface TEXT,
    prior_races_found INTEGER NOT NULL,
    analyzed_races INTEGER NOT NULL,
    top3_corner_samples INTEGER NOT NULL,
    front_top3_rate_pct REAL,
    back_top3_rate_pct REAL,
    avg_top3_final_corner_pct REAL,
    avg_top3_frame_pct REAL,
    pace_bias TEXT,
    lane_bias TEXT,
    confidence TEXT,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key, model_version)
  )`).run();
}

async function persistBias(db, target, priorRaceCount, bias) {
  await ensureBiasTable(db);
  const generatedAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO lab_track_bias_snapshots
      (race_key,model_version,source_surface,prior_races_found,analyzed_races,top3_corner_samples,front_top3_rate_pct,back_top3_rate_pct,avg_top3_final_corner_pct,avg_top3_frame_pct,pace_bias,lane_bias,confidence,generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_key,model_version) DO UPDATE SET
      source_surface=excluded.source_surface,
      prior_races_found=excluded.prior_races_found,
      analyzed_races=excluded.analyzed_races,
      top3_corner_samples=excluded.top3_corner_samples,
      front_top3_rate_pct=excluded.front_top3_rate_pct,
      back_top3_rate_pct=excluded.back_top3_rate_pct,
      avg_top3_final_corner_pct=excluded.avg_top3_final_corner_pct,
      avg_top3_frame_pct=excluded.avg_top3_frame_pct,
      pace_bias=excluded.pace_bias,
      lane_bias=excluded.lane_bias,
      confidence=excluded.confidence,
      generated_at=excluded.generated_at
  `).bind(
    target.race_key,"1.7.0",target.surface,priorRaceCount,bias.analyzedRaceCount,bias.top3CornerSamples,
    bias.frontTop3RatePct,bias.backTop3RatePct,bias.avgTop3FinalCornerPct,bias.avgTop3FramePct,
    bias.paceBias,bias.laneBias,bias.confidence,generatedAt
  ).run();
  return generatedAt;
}

async function trackBiasResponse(url, db) {
  const target = await resolveTargetRace(url, db);
  const prior = await priorRaces(db, target);
  const maxRaces = Math.max(1, Math.min(10, Number(url.searchParams.get("max_races") || 10)));
  const selected = prior.slice(-maxRaces);
  const analyses = [];

  for (const race of selected) {
    try {
      analyses.push(await analyzePriorRace(db, race));
    } catch (error) {
      analyses.push({ ok: false, raceNo: race.race_no, raceName: race.race_name, reason: String(error) });
    }
  }

  const bias = aggregateBias(analyses);
  const persist = url.searchParams.get("persist") === "1";
  const persistedAt = persist ? await persistBias(db, target, prior.length, bias) : null;

  return {
    ok: true,
    stage: "same-day-track-bias",
    version: "1.7.0",
    targetRace: {
      raceKey: target.race_key,
      date: target.race_date,
      venue: target.venue,
      raceNo: target.race_no,
      raceName: target.race_name,
      surface: target.surface,
      distance: target.distance,
    },
    leakageGuard: `Only same-venue ${target.surface} races with race_no < ${target.race_no} are used. Target/future races are excluded.`,
    priorSameSurfaceRacesFound: prior.length,
    selectedPriorRaces: selected.length,
    bias,
    interpretation: {
      paceBias: "Uses final-corner positions of top-3 finishers from prior same-surface races.",
      laneBias: "Uses D1 frame numbers of top-3 finishers; it is a frame-position proxy, not a path-level rail measurement.",
      caution: "Bias remains separate from final prediction until running-style evidence is persisted and validated.",
    },
    persisted: persist,
    persistedAt,
    races: analyses,
    next: "Persist multi-race running-style evidence, combine each horse style with this same-day bias, then activate paceStyleFit with confidence weighting.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.7.0",
        phase: "same-day track bias evidence",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/track-bias") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await trackBiasResponse(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.7.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
