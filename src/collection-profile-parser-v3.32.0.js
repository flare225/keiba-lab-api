import {decodeJraProfileRaceCells} from './history-profile-layout-v3.27.0.js';
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

function rowCells(rowHtml) {
  return [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)]
    .map((m) => text(m[1]));
}

function parseJapaneseDate(value) {
  const m = String(value || "").match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function parseCourse(value) {
  const m = String(value || "").replace(/\s+/g, "").match(/^(芝|ダート|ダ|障害)(\d{3,4})(?:m|メートル)?$/);
  if (!m || Number(m[2]) < 400 || Number(m[2]) > 7000) return { surface: null, distance: null };
  return {
    surface: m[1] === "ダ" ? "ダート" : m[1],
    distance: Number(m[2]),
  };
}

function numberOrNull(value) {
  const m = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function integerOrNull(value) {
  const m = String(value ?? "").match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function parseBodyWeight(value) {
  const s = String(value || "");
  const weight = s.match(/(\d{3})/);
  const change = s.match(/[（(]\s*([+-]?\d+)\s*[）)]/);
  return {
    bodyWeight: weight ? Number(weight[1]) : null,
    bodyWeightChange: change ? Number(change[1]) : null,
  };
}

function normalizeCondition(value) {
  const s = String(value || "").replace(/\s+/g, "");
  if (/不良/.test(s)) return "不良";
  if (/稍重/.test(s)) return "稍重";
  if (/重/.test(s)) return "重";
  if (/良/.test(s)) return "良";
  return s || null;
}

export function extractProfileLinks(html, runnerNames, baseUrl) {
  const wanted = new Set(runnerNames);
  const found = new Map();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const anchorText = text(m[2]);
    if (!wanted.has(anchorText) || found.has(anchorText)) continue;
    try {
      const url = new URL(m[1].replace(/&amp;/g, "&"), baseUrl);
      const cname = url.searchParams.get("CNAME") || "";
      if (!/\/JRADB\/accessU\.html/i.test(url.pathname)) continue;
      if (!/^pw01dud\d{2}/i.test(cname)) continue;
      found.set(anchorText, url.href);
    } catch {}
  }
  return found;
}

export function parsePastPerformances(html, horseName, profileUrl, beforeDate, limit) {
  const rows = [];

  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = rowCells(match[1]);
    if (cells.length < 14) continue;

    const raceDate = parseJapaneseDate(cells[0]);
    const course = parseCourse(cells[3]);
    if (!raceDate || !course.distance) continue;
    if (raceDate >= beforeDate) continue; // strict look-ahead leakage guard

    // Observed JRA horse-profile history structure (verified 2026-10-06):
    // 0 date, 1 venue, 2 race name, 3 surface+distance, 4 going,
    // 5 field size, 6 popularity, 7 finish, 8 jockey,
    // 9 assigned weight, 10 body weight, 11 time, 12 Rt, 13 winner.
    // There is no horse-number or last-3F column in this profile table.
    const decoded = decodeJraProfileRaceCells(cells);
    const fieldSize = decoded.fieldSize;
    const popularity = decoded.popularity;
    const finishPosition = decoded.finishPosition;
    const assignedWeight = decoded.assignedWeight;
    const body = {bodyWeight:decoded.bodyWeight,bodyWeightChange:decoded.bodyWeightChange};
    const last3f = null;

    rows.push({
      horseName,
      raceDate,
      venue: cells[1] || null,
      raceName: cells[2] || null,
      surface: course.surface,
      distance: course.distance,
      finishPosition,
      fieldSize,
      popularity,
      odds: null,
      jockey: decoded.jockey,
      assignedWeight,
      bodyWeight: body.bodyWeight,
      bodyWeightChange: body.bodyWeightChange,
      timeText: decoded.timeText,
      last3f,
      cornerPositions: null,
      trackCondition: normalizeCondition(cells[4]),
      sourceUrl: profileUrl,
    });
  }

  rows.sort((a, b) => b.raceDate.localeCompare(a.raceDate));

  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.raceDate}|${row.venue}|${row.raceName}|${row.distance}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped.slice(0, limit);
}

export async function ensureHistoryTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS jra_past_performances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    horse_name TEXT NOT NULL,
    race_date TEXT NOT NULL,
    venue TEXT,
    race_name TEXT,
    surface TEXT,
    distance INTEGER,
    finish_position INTEGER,
    field_size INTEGER,
    popularity INTEGER,
    odds REAL,
    jockey TEXT,
    assigned_weight REAL,
    body_weight INTEGER,
    body_weight_change INTEGER,
    time_text TEXT,
    last3f REAL,
    corner_positions TEXT,
    track_condition TEXT,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    UNIQUE(horse_name, race_date, venue, race_name)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_jra_past_perf_horse_date ON jra_past_performances(horse_name, race_date DESC)").run();
}
