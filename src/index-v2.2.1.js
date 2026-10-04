import app from "./index-v2.2.0.js";

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

function cleanText(value) {
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
      "user-agent": "keiba-lab/2.2.1 (+official course metadata repair)",
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

function normalizeDistance(raw) {
  const digits = String(raw || "").replace(/[^0-9]/g, "");
  const n = Number(digits);
  return Number.isInteger(n) && n >= 800 && n <= 5000 ? n : null;
}

function normalizeSurface(raw) {
  const s = String(raw || "");
  if (s.includes("芝")) return "芝";
  if (s.includes("ダート") || s === "ダ") return "ダート";
  if (s.includes("障害")) return "障害";
  return null;
}

function parseOfficialCourse(html, raceName) {
  const allText = cleanText(html);
  let context = allText.slice(0, 7000);
  if (raceName) {
    const idx = allText.indexOf(raceName);
    if (idx >= 0) context = allText.slice(Math.max(0, idx - 500), idx + 2200);
  }

  const patterns = [
    /コース\s*[:：]\s*([1-5](?:,?\d{3}))\s*(?:メートル|m)?\s*[（(]?\s*(芝|ダート|障害)/i,
    /([1-5](?:,?\d{3}))\s*(?:メートル|m)?\s*[（(]\s*(芝|ダート|障害)/i,
    /(芝|ダート|障害)\s*[・･]?\s*([1-5](?:,?\d{3}))\s*(?:メートル|m)?/i,
  ];

  for (const pattern of patterns) {
    const m = context.match(pattern);
    if (!m) continue;
    if (/^\d/.test(m[1])) {
      const distance = normalizeDistance(m[1]);
      const surface = normalizeSurface(m[2]);
      if (distance && surface) return { distance, surface, raw: m[0] };
    } else {
      const surface = normalizeSurface(m[1]);
      const distance = normalizeDistance(m[2]);
      if (distance && surface) return { distance, surface, raw: m[0] };
    }
  }

  return { distance: null, surface: null, raw: null };
}

async function repairCourseMetadata(url, db) {
  const date = url.searchParams.get("date");
  const venue = url.searchParams.get("venue");
  const raceNoParam = url.searchParams.get("race_no");
  const raceNo = raceNoParam == null ? null : Number(raceNoParam);
  if (!validDate(date)) throw new Error("date=YYYY-MM-DD is required");
  if (raceNo != null && (!Number.isInteger(raceNo) || raceNo < 1 || raceNo > 12)) {
    throw new Error("race_no must be 1-12 when supplied");
  }

  let sql = `SELECT race_key,race_date,venue,race_no,race_name,surface,distance,source_url FROM jra_races WHERE race_date=?`;
  const binds = [date];
  if (venue) { sql += ` AND venue=?`; binds.push(venue); }
  if (raceNo != null) { sql += ` AND race_no=?`; binds.push(raceNo); }
  sql += ` ORDER BY venue,race_no`;

  const rr = await db.prepare(sql).bind(...binds).all();
  const races = rr.results || [];
  const results = [];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const race of races) {
    if (!race.source_url) {
      failed++;
      results.push({ raceKey: race.race_key, status: "failed", reason: "missing source_url" });
      continue;
    }

    try {
      const page = await fetchHtml(race.source_url);
      if (!page.ok) {
        failed++;
        results.push({ raceKey: race.race_key, status: "failed", reason: `HTTP ${page.status}` });
        continue;
      }
      const parsed = parseOfficialCourse(page.body, race.race_name);
      if (!parsed.distance || !parsed.surface) {
        failed++;
        results.push({ raceKey: race.race_key, status: "failed", reason: "official course not parsed" });
        continue;
      }

      const before = { surface: race.surface, distance: Number(race.distance) || null };
      const after = { surface: parsed.surface, distance: parsed.distance };
      const changed = before.surface !== after.surface || before.distance !== after.distance;

      if (changed) {
        await db.prepare(`UPDATE jra_races SET surface=?, distance=?, fetched_at=? WHERE race_key=?`)
          .bind(after.surface, after.distance, new Date().toISOString(), race.race_key).run();
        updated++;
      } else {
        unchanged++;
      }

      results.push({
        raceKey: race.race_key,
        venue: race.venue,
        raceNo: race.race_no,
        raceName: race.race_name,
        status: changed ? "repaired" : "unchanged",
        before,
        after,
        officialMatch: parsed.raw,
      });
    } catch (error) {
      failed++;
      results.push({ raceKey: race.race_key, status: "failed", reason: String(error) });
    }
  }

  const critical = results.filter((r) => r.raceNo === 11 && ["東京", "京都"].includes(r.venue));

  return {
    ok: failed === 0,
    stage: "official-course-metadata-repair",
    version: "2.2.1",
    date,
    scope: { venue: venue || "ALL", raceNo: raceNo ?? "ALL" },
    inspected: races.length,
    updated,
    unchanged,
    failed,
    criticalChecks: critical,
    invalidatedAnalysisNotice: updated > 0
      ? "Any ranking/integrated snapshot created before this repair should be regenerated because course-distance inputs may have been wrong."
      : null,
    results,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return json({
        ok: true,
        service: "keiba-lab-api",
        version: "2.2.1",
        phase: "official course metadata integrity repair",
        note: "Distance parser now accepts JRA comma-formatted distances such as 1,800 and 2,400 metres.",
      });
    }

    if (url.pathname === "/v1/lab/repair-course-metadata") {
      if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, 500);
      try {
        return json(await repairCourseMetadata(url, env.DB));
      } catch (error) {
        return json({ ok: false, version: "2.2.1", error: String(error) }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (app.scheduled) return app.scheduled(event, env, ctx);
  },
};
