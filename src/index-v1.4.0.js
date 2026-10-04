import app from "./index-v1.3.3.js";

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

function finishPercentile(row) {
  const finish = Number(row.finish_position);
  const field = Number(row.field_size);
  if (!Number.isFinite(finish) || !Number.isFinite(field) || finish < 1 || field < 2 || finish > field) return null;
  return clamp(1 - (finish - 1) / (field - 1), 0, 1);
}

function weightedAverage(values, weights) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const w = weights[i] ?? 1;
    if (v == null || !Number.isFinite(v)) continue;
    num += v * w;
    den += w;
  }
  return den ? num / den : null;
}

function average(values) {
  const valid = values.filter((v) => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function summarizeRows(rows) {
  const percentiles = rows.map(finishPercentile);
  const validFinish = rows.filter((r) => finishPercentile(r) != null);
  const wins = validFinish.filter((r) => Number(r.finish_position) === 1).length;
  const top3 = validFinish.filter((r) => Number(r.finish_position) <= 3).length;
  const last3fValues = rows.map((r) => Number(r.last3f)).filter((v) => Number.isFinite(v) && v > 0);

  return {
    rows: rows.length,
    validFinishRows: validFinish.length,
    performanceIndex: validFinish.length ? round1(average(percentiles) * 100) : null,
    winRatePct: validFinish.length ? round1((wins / validFinish.length) * 100) : null,
    top3RatePct: validFinish.length ? round1((top3 / validFinish.length) * 100) : null,
    avgLast3f: last3fValues.length ? round1(average(last3fValues)) : null,
    bestLast3f: last3fValues.length ? round1(Math.min(...last3fValues)) : null,
  };
}

function trackBreakdown(rows) {
  const order = ["良", "稍重", "重", "不良"];
  return order.map((condition) => {
    const subset = rows.filter((r) => r.track_condition === condition);
    return { condition, ...summarizeRows(subset) };
  }).filter((x) => x.rows > 0);
}

function courseDistanceFeatures(history, race) {
  const sameSurface = history.filter((r) => r.surface === race.surface);
  const exactDistance = sameSurface.filter((r) => Number(r.distance) === Number(race.distance));
  const nearDistance = sameSurface.filter((r) => Math.abs(Number(r.distance) - Number(race.distance)) <= 200);
  const sameVenue = sameSurface.filter((r) => r.venue === race.venue);
  const sameVenueDistance = sameVenue.filter((r) => Math.abs(Number(r.distance) - Number(race.distance)) <= 200);

  return {
    sameSurface: summarizeRows(sameSurface),
    exactDistance: summarizeRows(exactDistance),
    within200m: summarizeRows(nearDistance),
    sameVenue: summarizeRows(sameVenue),
    sameVenueWithin200m: summarizeRows(sameVenueDistance),
  };
}

function recentFormFeatures(history) {
  const latest = history.slice(0, 5);
  const p = latest.map(finishPercentile);
  const weights = [5, 4, 3, 2, 1];
  const weighted = weightedAverage(p, weights);

  const newest3 = latest.slice(0, 3).map(finishPercentile).filter((v) => v != null);
  const older2 = latest.slice(3, 5).map(finishPercentile).filter((v) => v != null);
  const newestAvg = newest3.length ? average(newest3) : null;
  const olderAvg = older2.length ? average(older2) : null;
  const trend = newestAvg != null && olderAvg != null ? round1((newestAvg - olderAvg) * 100) : null;

  return {
    rows: latest.length,
    recentFormIndex: weighted != null ? round1(weighted * 100) : null,
    recent3Index: newestAvg != null ? round1(newestAvg * 100) : null,
    older2Index: olderAvg != null ? round1(olderAvg * 100) : null,
    trendPoints: trend,
    latestRaceDate: latest[0]?.race_date || null,
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

  const rr = await db.prepare(`
    SELECT horse_no,frame_no,horse_name,sex,age,assigned_weight,jockey,trainer
    FROM jra_runners
    WHERE race_key=?
    ORDER BY horse_no
  `).bind(race.race_key).all();

  return { race, runners: rr.results || [] };
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

function provisionalCoverage(history, race, currentTrack) {
  const valid = history.filter((r) => finishPercentile(r) != null);
  const sameSurface = history.filter((r) => r.surface === race.surface);
  const near = sameSurface.filter((r) => Math.abs(Number(r.distance) - Number(race.distance)) <= 200);
  const sameVenue = sameSurface.filter((r) => r.venue === race.venue);
  const trackRows = currentTrack ? sameSurface.filter((r) => r.track_condition === currentTrack) : [];

  return {
    basicAbility: valid.length >= 3 ? "ready" : valid.length ? "low-sample" : "missing",
    recentPerformance: valid.length >= 3 ? "ready" : valid.length ? "low-sample" : "missing",
    courseDistanceFit: near.length >= 2 || sameVenue.length >= 2 ? "ready" : (near.length || sameVenue.length) ? "low-sample" : "missing",
    paceStyle: history.some((r) => r.corner_positions) ? "partial" : "blocked-no-corner-data",
    groundFit: currentTrack ? (trackRows.length ? "partial" : "no-same-going-sample") : "needs-current-track",
    conditionPrep: "blocked-no-workout-data",
  };
}

async function featureResponse(url, db) {
  const { race, runners } = await resolveRace(url, db);
  const currentTrack = url.searchParams.get("track") || null;
  const output = [];

  for (const runner of runners) {
    const history = await loadHistory(db, runner.horse_name, race.race_date);
    const recent = recentFormFeatures(history);
    const ability = summarizeRows(history);
    const courseDistance = courseDistanceFeatures(history, race);
    const sameGoingRows = currentTrack ? history.filter((r) => r.surface === race.surface && r.track_condition === currentTrack) : [];
    const ground = currentTrack ? summarizeRows(sameGoingRows) : null;

    output.push({
      horseNo: runner.horse_no,
      frameNo: runner.frame_no,
      horseName: runner.horse_name,
      jockey: runner.jockey,
      trainer: runner.trainer,
      assignedWeight: runner.assigned_weight,
      historyRows: history.length,
      evidence: history.length >= 5 ? "full-5-race" : history.length >= 3 ? "usable" : history.length ? "thin" : "none",
      basicAbility: ability,
      recentForm: recent,
      courseDistance,
      groundFit: currentTrack ? { targetCondition: currentTrack, ...ground } : { targetCondition: null, status: "current track condition not supplied" },
      trackBreakdown: trackBreakdown(history.filter((r) => r.surface === race.surface)),
      readiness: provisionalCoverage(history, race, currentTrack),
      sourceRaceDates: history.slice(0, 5).map((r) => r.race_date),
    });
  }

  output.sort((a, b) => {
    const av = a.recentForm.recentFormIndex ?? -1;
    const bv = b.recentForm.recentFormIndex ?? -1;
    return bv - av || a.horseNo - b.horseNo;
  });

  return {
    ok: true,
    stage: "interpretable-race-features",
    version: "1.4.0",
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
    rankingBasis: "sorted by recentFormIndex only; this is not yet a final prediction score",
    scoringPolicy: {
      note: "No 100-point prediction is emitted until pace/style and condition/prep inputs exist.",
      targetWeights: {
        basicAbilityResults: 25,
        recentPerformanceDevelopment: 20,
        paceStyleFit: 20,
        courseDistanceFit: 15,
        ground: 10,
        conditionPrep: 10,
      },
    },
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
        version: "1.4.0",
        phase: "interpretable feature engine",
        missing: env.DB ? [] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/features") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await featureResponse(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "1.4.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
