import app from "./index-v1.4.0.js";

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

function average(values) {
  const valid = values.filter((v) => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function weightedAverage(values, weights) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const weight = weights[i] ?? 1;
    if (value == null || !Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    num += value * weight;
    den += weight;
  }
  return den ? num / den : null;
}

function finishPercentile(row) {
  const finish = Number(row.finish_position);
  const field = Number(row.field_size);
  if (!Number.isFinite(finish) || !Number.isFinite(field) || finish < 1 || field < 2 || finish > field) return null;
  return clamp(1 - (finish - 1) / (field - 1), 0, 1);
}

function summarizeRows(rows) {
  const percentiles = rows.map(finishPercentile).filter((v) => v != null);
  const wins = rows.filter((r) => Number(r.finish_position) === 1).length;
  const top3 = rows.filter((r) => Number(r.finish_position) >= 1 && Number(r.finish_position) <= 3).length;
  const last3fValues = rows.map((r) => Number(r.last3f)).filter((v) => Number.isFinite(v) && v > 0);
  return {
    rows: rows.length,
    validFinishRows: percentiles.length,
    performanceIndex: percentiles.length ? round1(average(percentiles) * 100) : null,
    winRatePct: percentiles.length ? round1((wins / percentiles.length) * 100) : null,
    top3RatePct: percentiles.length ? round1((top3 / percentiles.length) * 100) : null,
    avgLast3f: last3fValues.length ? round1(average(last3fValues)) : null,
  };
}

function recentFormFeatures(history) {
  const latest = history.slice(0, 5);
  const percentiles = latest.map(finishPercentile);
  const recentForm = weightedAverage(percentiles, [5, 4, 3, 2, 1]);
  const newest3 = latest.slice(0, 3).map(finishPercentile).filter((v) => v != null);
  const older2 = latest.slice(3, 5).map(finishPercentile).filter((v) => v != null);
  const newestAvg = newest3.length ? average(newest3) : null;
  const olderAvg = older2.length ? average(older2) : null;
  return {
    rows: latest.length,
    recentFormIndex: recentForm != null ? round1(recentForm * 100) : null,
    recent3Index: newestAvg != null ? round1(newestAvg * 100) : null,
    older2Index: olderAvg != null ? round1(olderAvg * 100) : null,
    trendPoints: newestAvg != null && olderAvg != null ? round1((newestAvg - olderAvg) * 100) : null,
  };
}

function courseDistanceFeatures(history, race) {
  const sameSurface = history.filter((r) => r.surface === race.surface);
  const exactDistance = sameSurface.filter((r) => Number(r.distance) === Number(race.distance));
  const within200m = sameSurface.filter((r) => Math.abs(Number(r.distance) - Number(race.distance)) <= 200);
  const sameVenue = sameSurface.filter((r) => r.venue === race.venue);
  const sameVenueWithin200m = sameVenue.filter((r) => Math.abs(Number(r.distance) - Number(race.distance)) <= 200);

  const blocks = {
    exactDistance: summarizeRows(exactDistance),
    within200m: summarizeRows(within200m),
    sameVenue: summarizeRows(sameVenue),
    sameVenueWithin200m: summarizeRows(sameVenueWithin200m),
  };

  const candidates = [
    blocks.sameVenueWithin200m,
    blocks.exactDistance,
    blocks.within200m,
    blocks.sameVenue,
  ];
  const baseWeights = [4, 3, 2, 1];
  const values = [];
  const weights = [];
  for (let i = 0; i < candidates.length; i++) {
    const block = candidates[i];
    if (block.performanceIndex == null || block.rows <= 0) continue;
    values.push(block.performanceIndex);
    weights.push(baseWeights[i] * Math.min(block.rows, 3) / 3);
  }

  return {
    ...blocks,
    courseDistanceIndex: values.length ? round1(weightedAverage(values, weights)) : null,
  };
}

function groundFeatures(history, race, currentTrack) {
  if (!currentTrack) return { targetCondition: null, rows: 0, performanceIndex: null, status: "needs-current-track" };
  const rows = history.filter((r) => r.surface === race.surface && r.track_condition === currentTrack);
  const summary = summarizeRows(rows);
  return {
    targetCondition: currentTrack,
    ...summary,
    status: rows.length ? "evidence" : "no-same-going-sample",
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
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
  if (!race) throw new Error("race not found in D1");

  const runners = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return { race, runners: runners.results || [] };
}

async function loadHistory(db, horseName, beforeDate) {
  const result = await db.prepare(`
    SELECT horse_name,race_date,venue,race_name,surface,distance,finish_position,field_size,popularity,jockey,assigned_weight,body_weight,body_weight_change,time_text,last3f,corner_positions,track_condition
    FROM jra_past_performances
    WHERE horse_name=? AND race_date < ?
    ORDER BY race_date DESC
    LIMIT 10
  `).bind(horseName, beforeDate).all();
  return result.results || [];
}

function scoreRunner(history, race, currentTrack) {
  const ability = summarizeRows(history);
  const recent = recentFormFeatures(history);
  const course = courseDistanceFeatures(history, race);
  const ground = groundFeatures(history, race, currentTrack);

  const targetWeights = {
    basicAbilityResults: 25,
    recentPerformanceDevelopment: 20,
    paceStyleFit: 20,
    courseDistanceFit: 15,
    ground: 10,
    conditionPrep: 10,
  };

  const components = [
    { key: "basicAbilityResults", score: ability.performanceIndex, weight: targetWeights.basicAbilityResults },
    { key: "recentPerformanceDevelopment", score: recent.recentFormIndex, weight: targetWeights.recentPerformanceDevelopment },
    { key: "courseDistanceFit", score: course.courseDistanceIndex, weight: targetWeights.courseDistanceFit },
    { key: "ground", score: ground.performanceIndex, weight: targetWeights.ground },
  ];

  let weightedTotal = 0;
  let availableWeight = 0;
  const usedBlocks = [];
  const missingBlocks = ["paceStyleFit", "conditionPrep"];

  for (const component of components) {
    if (component.score == null || !Number.isFinite(component.score)) {
      missingBlocks.push(component.key);
      continue;
    }
    weightedTotal += component.score * component.weight;
    availableWeight += component.weight;
    usedBlocks.push(component.key);
  }

  const evidenceScore = availableWeight ? round1(weightedTotal / availableWeight) : null;
  const modelCoveragePct = round1(availableWeight);
  const evidenceDepthPct = round1(clamp(history.length / 5, 0, 1) * 100);
  const confidencePct = round1(modelCoveragePct * 0.6 + evidenceDepthPct * 0.4);

  return {
    evidenceScore,
    modelCoveragePct,
    evidenceDepthPct,
    confidencePct,
    usedBlocks,
    missingBlocks: [...new Set(missingBlocks)],
    components: {
      basicAbilityResults: ability.performanceIndex,
      recentPerformanceDevelopment: recent.recentFormIndex,
      courseDistanceFit: course.courseDistanceIndex,
      ground: ground.performanceIndex,
      paceStyleFit: null,
      conditionPrep: null,
    },
    detail: { ability, recent, course, ground },
    targetWeights,
  };
}

async function ensureSnapshotTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_prediction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    evidence_score REAL,
    model_coverage_pct REAL,
    confidence_pct REAL,
    basic_score REAL,
    recent_score REAL,
    course_distance_score REAL,
    ground_score REAL,
    pace_style_score REAL,
    condition_prep_score REAL,
    final_prediction INTEGER NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key, horse_no, model_version, track_condition)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_prediction_snapshots_race ON lab_prediction_snapshots(race_key, model_version, horse_no)").run();
}

async function persistSnapshots(db, race, track, runners) {
  await ensureSnapshotTable(db);
  const generatedAt = new Date().toISOString();
  const statements = runners.map((runner) => db.prepare(`
    INSERT INTO lab_prediction_snapshots
      (race_key,horse_no,horse_name,model_version,track_condition,evidence_score,model_coverage_pct,confidence_pct,basic_score,recent_score,course_distance_score,ground_score,pace_style_score,condition_prep_score,final_prediction,generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_key,horse_no,model_version,track_condition) DO UPDATE SET
      horse_name=excluded.horse_name,
      evidence_score=excluded.evidence_score,
      model_coverage_pct=excluded.model_coverage_pct,
      confidence_pct=excluded.confidence_pct,
      basic_score=excluded.basic_score,
      recent_score=excluded.recent_score,
      course_distance_score=excluded.course_distance_score,
      ground_score=excluded.ground_score,
      pace_style_score=excluded.pace_style_score,
      condition_prep_score=excluded.condition_prep_score,
      final_prediction=excluded.final_prediction,
      generated_at=excluded.generated_at
  `).bind(
    race.race_key,
    runner.horseNo,
    runner.horseName,
    "1.5.0",
    track,
    runner.evidenceScore,
    runner.modelCoveragePct,
    runner.confidencePct,
    runner.components.basicAbilityResults,
    runner.components.recentPerformanceDevelopment,
    runner.components.courseDistanceFit,
    runner.components.ground,
    null,
    null,
    0,
    generatedAt
  ));
  if (statements.length) await db.batch(statements);
  return statements.length;
}

async function rankingResponse(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const currentTrack = url.searchParams.get("track") || null;
  const persist = url.searchParams.get("persist") === "1";
  const output = [];

  for (const runner of runners) {
    const history = await loadHistory(db, runner.horse_name, race.race_date);
    const score = scoreRunner(history, race, currentTrack);
    output.push({
      horseNo: runner.horse_no,
      frameNo: runner.frame_no,
      horseName: runner.horse_name,
      jockey: runner.jockey,
      trainer: runner.trainer,
      assignedWeight: runner.assigned_weight,
      historyRows: history.length,
      ...score,
    });
  }

  output.sort((a, b) => {
    const av = a.evidenceScore ?? -1;
    const bv = b.evidenceScore ?? -1;
    return bv - av || b.confidencePct - a.confidencePct || a.horseNo - b.horseNo;
  });
  output.forEach((runner, index) => { runner.evidenceRank = index + 1; });

  const persistedSnapshots = persist ? await persistSnapshots(db, race, currentTrack, output) : 0;

  return {
    ok: true,
    stage: "evidence-weighted-ranking",
    version: "1.5.0",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      surface: race.surface,
      distance: race.distance,
      runnerCount: runners.length,
      trackConditionInput: currentTrack,
    },
    leakageGuard: `Every history query is restricted to race_date < ${race.race_date}`,
    finalPrediction: false,
    scoreMeaning: "Evidence score normalized only across feature blocks that currently have data. It is NOT the final 100-point prediction score.",
    fullModelCoverageCeilingNow: currentTrack ? 70 : 60,
    blockedBlocks: ["paceStyleFit", "conditionPrep"],
    validationPolicy: "Persist snapshots before result ingestion; tune weights only with historical holdout/backtest, never on the target race result.",
    persistedSnapshots,
    runners: output,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "1.5.0",
        phase: "evidence-weighted ranking + backtest snapshots",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/rank") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await rankingResponse(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.5.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
