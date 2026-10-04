import app from "./index-v2.2.1.js";

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

async function paceGap(request, env, ctx) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNo = Number(url.searchParams.get("race_no"));
  if (!validDate(date) || !venue || !Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12) {
    throw new Error("date=YYYY-MM-DD, venue, race_no=1-12 are required");
  }

  const result = await invoke(url.origin, "/v1/lab/pace-style", {
    date,
    venue,
    race_no: raceNo,
    persist: 0,
  }, env, ctx);

  const d = result.data || {};
  const runners = Array.isArray(d.runners) ? d.runners : [];
  const missing = runners
    .filter((r) => r?.status !== "scored")
    .map((r) => ({
      horseNo: r.horseNo ?? null,
      frameNo: r.frameNo ?? null,
      horseName: r.horseName ?? null,
      status: r.status ?? "unknown",
      sourceRaceDate: r.sourceRaceDate ?? null,
      sourceRaceName: r.sourceRaceName ?? null,
      httpStatus: r.httpStatus ?? null,
    }));

  return {
    ok: result.httpStatus < 400 && d.ok !== false,
    stage: "pace-style-gap-diagnostics",
    version: "2.2.2",
    race: d.race || { date, venue, raceNo },
    scoredRunners: d.scoredRunners ?? null,
    coveragePct: d.coveragePct ?? null,
    runnerCount: runners.length,
    missingCount: missing.length,
    missingRunners: missing,
    diagnosisComplete: runners.length > 0,
    next: missing.length
      ? "Repair only these missing runners, then rerun boost3 step=3 before activating the final condition/prep 10-point block."
      : "Pace/style coverage is 100%; proceed to condition/prep evidence and final 100-point model.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "2.2.2",
        phase: "pace-style gap diagnostics before final-model expansion",
      });
    }

    if (url.pathname === "/v1/lab/pace-gap") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await paceGap(request, env, ctx));
      } catch (error) {
        return json({ ok: false, version: "2.2.2", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
