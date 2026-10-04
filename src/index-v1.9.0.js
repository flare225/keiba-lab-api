import app from "./index-v1.8.0.js";

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

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
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

  const rr = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,jockey,trainer,assigned_weight
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return { race, runners: rr.results || [] };
}

async function loadEvidenceSnapshot(db, raceKey, horseNo, track) {
  if (track) {
    return db.prepare(`
      SELECT evidence_score,model_coverage_pct,confidence_pct,
             basic_score,recent_score,course_distance_score,ground_score,
             generated_at
      FROM lab_prediction_snapshots
      WHERE race_key=? AND horse_no=? AND model_version='1.5.0' AND track_condition=?
      ORDER BY generated_at DESC LIMIT 1
    `).bind(raceKey, horseNo, track).first();
  }

  return db.prepare(`
    SELECT evidence_score,model_coverage_pct,confidence_pct,
           basic_score,recent_score,course_distance_score,ground_score,
           track_condition,generated_at
    FROM lab_prediction_snapshots
    WHERE race_key=? AND horse_no=? AND model_version='1.5.0'
    ORDER BY generated_at DESC LIMIT 1
  `).bind(raceKey, horseNo).first();
}

async function loadPaceStyleSnapshot(db, raceKey, horseNo) {
  return db.prepare(`
    SELECT style_key,style_label,source_race_date,source_race_name,
           final_corner,source_field_size,corner_percentile,
           pace_bias,lane_bias,bias_confidence,raw_fit_score,
           pace_style_fit_score,evidence_confidence,generated_at
    FROM lab_pace_style_snapshots
    WHERE race_key=? AND horse_no=? AND model_version='1.8.0'
    ORDER BY generated_at DESC LIMIT 1
  `).bind(raceKey, horseNo).first();
}

function scoreIntegrated(base, pace) {
  const targetWeights = {
    basicAbilityResults: 25,
    recentPerformanceDevelopment: 20,
    paceStyleFit: 20,
    courseDistanceFit: 15,
    ground: 10,
    conditionPrep: 10,
  };

  const components = [
    { key: "basicAbilityResults", score: base?.basic_score, weight: 25 },
    { key: "recentPerformanceDevelopment", score: base?.recent_score, weight: 20 },
    { key: "paceStyleFit", score: pace?.pace_style_fit_score, weight: 20 },
    { key: "courseDistanceFit", score: base?.course_distance_score, weight: 15 },
    { key: "ground", score: base?.ground_score, weight: 10 },
  ];

  let earnedPoints = 0;
  let availableWeight = 0;
  const usedBlocks = [];
  const missingBlocks = [];

  for (const c of components) {
    const score = Number(c.score);
    if (!Number.isFinite(score)) {
      missingBlocks.push(c.key);
      continue;
    }
    earnedPoints += (score / 100) * c.weight;
    availableWeight += c.weight;
    usedBlocks.push(c.key);
  }

  missingBlocks.push("conditionPrep");
  const normalizedEvidenceScore = availableWeight > 0 ? (earnedPoints / availableWeight) * 100 : null;

  return {
    preFinalPoints: round1(earnedPoints),
    availableWeight,
    modelCoveragePct: round1(availableWeight),
    normalizedEvidenceScore: normalizedEvidenceScore == null ? null : round1(normalizedEvidenceScore),
    targetWeights,
    usedBlocks,
    missingBlocks: [...new Set(missingBlocks)],
    components: {
      basicAbilityResults: base?.basic_score ?? null,
      recentPerformanceDevelopment: base?.recent_score ?? null,
      paceStyleFit: pace?.pace_style_fit_score ?? null,
      courseDistanceFit: base?.course_distance_score ?? null,
      ground: base?.ground_score ?? null,
      conditionPrep: null,
    },
  };
}

async function ensureIntegratedTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS lab_integrated_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_key TEXT NOT NULL,
    horse_no INTEGER NOT NULL,
    horse_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    track_condition TEXT,
    prefinal_points REAL,
    available_weight REAL,
    normalized_evidence_score REAL,
    basic_score REAL,
    recent_score REAL,
    pace_style_score REAL,
    course_distance_score REAL,
    ground_score REAL,
    condition_prep_score REAL,
    final_prediction INTEGER NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL,
    UNIQUE(race_key,horse_no,model_version,track_condition)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_lab_integrated_race ON lab_integrated_snapshots(race_key,model_version,horse_no)").run();
}

async function persistIntegrated(db, race, track, rows) {
  await ensureIntegratedTable(db);
  const generatedAt = new Date().toISOString();
  const statements = rows.map((r) => db.prepare(`
    INSERT INTO lab_integrated_snapshots
      (race_key,horse_no,horse_name,model_version,track_condition,prefinal_points,available_weight,
       normalized_evidence_score,basic_score,recent_score,pace_style_score,course_distance_score,
       ground_score,condition_prep_score,final_prediction,generated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(race_key,horse_no,model_version,track_condition) DO UPDATE SET
      horse_name=excluded.horse_name,
      prefinal_points=excluded.prefinal_points,
      available_weight=excluded.available_weight,
      normalized_evidence_score=excluded.normalized_evidence_score,
      basic_score=excluded.basic_score,
      recent_score=excluded.recent_score,
      pace_style_score=excluded.pace_style_score,
      course_distance_score=excluded.course_distance_score,
      ground_score=excluded.ground_score,
      condition_prep_score=excluded.condition_prep_score,
      final_prediction=excluded.final_prediction,
      generated_at=excluded.generated_at
  `).bind(
    race.race_key,r.horseNo,r.horseName,"1.9.0",track,
    r.preFinalPoints,r.availableWeight,r.normalizedEvidenceScore,
    r.components.basicAbilityResults,r.components.recentPerformanceDevelopment,
    r.components.paceStyleFit,r.components.courseDistanceFit,r.components.ground,null,0,generatedAt
  ));
  if (statements.length) await db.batch(statements);
  return statements.length;
}

async function integratedResponse(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const track = url.searchParams.get("track") || null;
  const persist = url.searchParams.get("persist") === "1";
  const output = [];

  for (const runner of runners) {
    const base = await loadEvidenceSnapshot(db, race.race_key, runner.horse_no, track);
    const pace = await loadPaceStyleSnapshot(db, race.race_key, runner.horse_no);
    const score = scoreIntegrated(base, pace);

    output.push({
      horseNo: runner.horse_no,
      frameNo: runner.frame_no,
      horseName: runner.horse_name,
      jockey: runner.jockey,
      trainer: runner.trainer,
      assignedWeight: runner.assigned_weight,
      ...score,
      style: pace ? {
        styleKey: pace.style_key,
        styleLabel: pace.style_label,
        sourceRaceDate: pace.source_race_date,
        sourceRaceName: pace.source_race_name,
        finalCorner: pace.final_corner,
        paceBias: pace.pace_bias,
        laneBias: pace.lane_bias,
        biasConfidence: pace.bias_confidence,
        evidenceConfidence: pace.evidence_confidence,
      } : null,
      sourceSnapshots: {
        baseModelVersion: base ? "1.5.0" : null,
        paceStyleModelVersion: pace ? "1.8.0" : null,
      },
    });
  }

  output.sort((a, b) => {
    const av = a.normalizedEvidenceScore ?? -1;
    const bv = b.normalizedEvidenceScore ?? -1;
    return bv - av || b.availableWeight - a.availableWeight || Number(a.horseNo) - Number(b.horseNo);
  });
  output.forEach((r, i) => { r.preFinalRank = i + 1; });

  const complete90Count = output.filter((r) => r.availableWeight === 90).length;
  const persistedSnapshots = persist ? await persistIntegrated(db, race, track, output) : 0;

  return {
    ok: true,
    stage: "integrated-90-point-preview",
    version: "1.9.0",
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      surface: race.surface,
      distance: race.distance,
      runnerCount: runners.length,
      trackConditionInput: track,
    },
    finalPrediction: false,
    modelCoverageCeilingNow: 90,
    complete90Count,
    conditionPrepStatus: "blocked-until pre-race condition/workout evidence is added",
    scoreMeaning: "preFinalPoints are weighted points actually earned from available blocks; normalizedEvidenceScore rescales only available evidence. Neither is the final 100-point prediction until conditionPrep is sourced.",
    leakageGuard: "Uses previously persisted pre-race snapshots; no target-race result is queried here.",
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
        version: "1.9.0",
        phase: "integrated 90-point pre-final model",
        missing: env.DB ? ["condition/prep evidence block"] : ["D1 binding: DB", "condition/prep evidence block"],
      });
    }

    if (url.pathname === "/v1/lab/integrated") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await integratedResponse(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.9.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
