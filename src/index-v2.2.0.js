import app from "./index-v2.1.0.js";

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

async function resolveRace(db, date, venue, raceNo) {
  return db.prepare(`
    SELECT race_key,race_date,venue,race_no,race_name,surface,distance,runner_count
    FROM jra_races
    WHERE race_date=? AND venue=? AND race_no=?
  `).bind(date, venue, raceNo).first();
}

async function invoke(origin, path, params, env, ctx) {
  const u = new URL(path, origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined) u.searchParams.set(key, String(value));
  }
  const response = await app.fetch(new Request(u.href, { method: "GET" }), env, ctx);
  let data;
  try {
    data = await response.json();
  } catch {
    data = { ok: false, error: `non-json response (${response.status})` };
  }
  return { httpStatus: response.status, data };
}

function step1Summary(result) {
  const d = result.data || {};
  return {
    ok: result.httpStatus < 400 && d.ok !== false,
    sourceVersion: d.version || null,
    profileLinksFound: d.profileLinksFound ?? null,
    horsesWithHistory: d.horsesWithHistory ?? null,
    savedRows: d.savedRows ?? null,
    totalStoredRowsForField: d.totalStoredRowsForField ?? null,
    failed: d.failed ?? null,
  };
}

function step2Summary(biasResult, rankResult) {
  const b = biasResult.data || {};
  const r = rankResult.data || {};
  return {
    ok: biasResult.httpStatus < 400 && rankResult.httpStatus < 400 && b.ok !== false && r.ok !== false,
    trackBias: {
      sourceVersion: b.version || null,
      priorSameSurfaceRacesFound: b.priorSameSurfaceRacesFound ?? null,
      selectedPriorRaces: b.selectedPriorRaces ?? null,
      analyzedRaceCount: b.bias?.analyzedRaceCount ?? null,
      paceBias: b.bias?.paceBias ?? null,
      laneBias: b.bias?.laneBias ?? null,
      confidence: b.bias?.confidence ?? null,
      persisted: b.persisted ?? b.persistedSnapshots ?? null,
    },
    baseRanking: {
      sourceVersion: r.version || null,
      persistedSnapshots: r.persistedSnapshots ?? null,
      runnerCount: Array.isArray(r.runners) ? r.runners.length : r.race?.runnerCount ?? null,
      top3: Array.isArray(r.runners) ? r.runners.slice(0, 3).map(x => ({
        rank: x.evidenceRank,
        horseNo: x.horseNo,
        horseName: x.horseName,
        evidenceScore: x.evidenceScore,
        confidencePct: x.confidencePct,
      })) : [],
    },
  };
}

function step3Summary(styleResult, integratedResult) {
  const s = styleResult.data || {};
  const i = integratedResult.data || {};
  return {
    ok: styleResult.httpStatus < 400 && integratedResult.httpStatus < 400 && s.ok !== false && i.ok !== false,
    paceStyle: {
      sourceVersion: s.version || null,
      scoredRunners: s.scoredRunners ?? null,
      coveragePct: s.coveragePct ?? null,
      persistedSnapshots: s.persistedSnapshots ?? null,
    },
    integrated90: {
      sourceVersion: i.version || null,
      complete90Count: i.complete90Count ?? null,
      persistedSnapshots: i.persistedSnapshots ?? null,
      runnerCount: Array.isArray(i.runners) ? i.runners.length : i.race?.runnerCount ?? null,
      top5: Array.isArray(i.runners) ? i.runners.slice(0, 5).map(x => ({
        rank: x.preFinalRank,
        horseNo: x.horseNo,
        horseName: x.horseName,
        preFinalPoints: x.preFinalPoints,
        normalizedEvidenceScore: x.normalizedEvidenceScore,
      })) : [],
    },
  };
}

async function boost3(request, env, ctx) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  const track = url.searchParams.get("track") || "良";
  const step = Number(url.searchParams.get("step") || 1);

  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  }
  if (![1, 2, 3].includes(step)) throw new Error("step must be 1, 2, or 3");

  const race = await resolveRace(env.DB, date, venue, raceNo);
  if (!race) throw new Error("race not found in D1");

  const common = { date, venue, race_no: raceNo };
  let result;
  let nextStep = null;

  if (step === 1) {
    const history = await invoke(url.origin, "/v1/lab/history-ingest", { ...common, limit: 5 }, env, ctx);
    result = { history: step1Summary(history) };
    nextStep = 2;
  } else if (step === 2) {
    const bias = await invoke(url.origin, "/v1/lab/track-bias", { ...common, persist: 1 }, env, ctx);
    const rank = await invoke(url.origin, "/v1/lab/rank", { ...common, track, persist: 1 }, env, ctx);
    result = step2Summary(bias, rank);
    nextStep = 3;
  } else {
    const style = await invoke(url.origin, "/v1/lab/pace-style", { ...common, persist: 1 }, env, ctx);
    const integrated = await invoke(url.origin, "/v1/lab/integrated", { ...common, track, persist: 1 }, env, ctx);
    result = step3Summary(style, integrated);
  }

  const q = new URLSearchParams({ date, venue, race_no: String(raceNo), track });
  if (nextStep) q.set("step", String(nextStep));

  return {
    ok: result?.ok !== false && result?.history?.ok !== false,
    stage: "three-stage-race-analysis-booster",
    version: "2.2.0",
    step,
    race: {
      raceKey: race.race_key,
      date: race.race_date,
      venue: race.venue,
      raceNo: race.race_no,
      raceName: race.race_name,
      surface: race.surface,
      distance: race.distance,
      runnerCount: race.runner_count,
      trackConditionInput: track,
    },
    stepMeaning: step === 1
      ? "1/3: ingest official pre-race history (up to 5 runs per horse)"
      : step === 2
        ? "2/3: persist same-day track bias and base evidence ranking"
        : "3/3: persist pace/style fit and integrated 90-point preview",
    result,
    nextStep,
    nextUrl: nextStep ? `/v1/lab/boost3?${q.toString()}` : null,
    complete: step === 3 && result?.ok === true,
    note: "The final condition/prep 10-point block is still intentionally separate until runner-specific pre-race evidence is validated.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "2.2.0",
        phase: "three-stage race analysis booster",
        missing: env.DB ? ["validated runner-specific condition/prep evidence for final 10 points"] : ["D1 binding: DB"],
      });
    }

    if (url.pathname === "/v1/lab/boost3") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await boost3(request, env, ctx));
      } catch (error) {
        return json({ ok: false, version: "2.2.0", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
