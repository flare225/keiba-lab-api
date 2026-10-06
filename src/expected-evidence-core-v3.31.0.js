// Existing LABO safe-core v1.5 calculation, reused without weight tuning.
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

export function scoreRunner(history, race, currentTrack) {
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
