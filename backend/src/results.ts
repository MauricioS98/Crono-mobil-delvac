import { normalizeNumber } from "./storage.js";
import { formatMs } from "./timeUtils.js";
import type {
  Event,
  ParsedCsv,
  Pilot,
  PilotPenalty,
  ResultRow,
  Test,
  TestPart,
  TimingPoint,
} from "./types.js";

export const UNIFIED_SCOPE = "unified";
/** Single shared penalty per pilot within a test (salida ↔ unificado) */
export const SHARED_PENALTY_SCOPE = "shared";

/** Resolve Desde/Hasta for a test (stored config, then query override, then defaults) */
export function resolveTestTimingPoints(
  event: Event,
  test: Test,
  fromOverride?: string,
  toOverride?: string
): { fromId: string | undefined; toId: string | undefined } {
  const points = [...event.timingPoints].sort((a, b) => a.order - b.order);
  return {
    fromId: fromOverride || test.fromPointId || points[0]?.id,
    toId: toOverride || test.toPointId || points[1]?.id,
  };
}

export function segmentLabelForTest(
  event: Event,
  test: Test,
  fromOverride?: string,
  toOverride?: string
): string {
  const { fromId, toId } = resolveTestTimingPoints(event, test, fromOverride, toOverride);
  const points = event.timingPoints;
  const fromName = points.find((p) => p.id === fromId)?.name ?? "Desde";
  const toName = points.find((p) => p.id === toId)?.name ?? "Hasta";
  return `${fromName} → ${toName}`;
}

function pickName(a: string, b?: string): string {
  return a || b || "";
}

function firstRacePassageByPilot(
  parsed: ParsedCsv
): Map<string, { number: string; name: string; tm: number; lap: number | null }> {
  const map = new Map<string, { number: string; name: string; tm: number; lap: number | null }>();
  for (const p of parsed.racePassages) {
    const key = normalizeNumber(p.number);
    if (!map.has(key)) {
      map.set(key, {
        number: p.number,
        name: p.name,
        tm: p.tmPasosMs,
        lap: p.lapTimeMs,
      });
    }
  }
  return map;
}

function firstLapPassageByPilot(
  parsed: ParsedCsv
): Map<string, { number: string; name: string; lap: number }> {
  const map = new Map<string, { number: string; name: string; lap: number }>();
  for (const p of parsed.racePassages) {
    const key = normalizeNumber(p.number);
    if (map.has(key)) continue;
    if (p.lapTimeMs == null || p.lapTimeMs <= 0) continue;
    map.set(key, { number: p.number, name: p.name, lap: p.lapTimeMs });
  }
  return map;
}

interface LapPilotResult {
  number: string;
  name: string;
  laps: number;
  totalTimeMs: number;
}

/** Lap count + total elapsed time per pilot from combined CSV */
function lapResultsByPilot(parsed: ParsedCsv): Map<string, LapPilotResult> {
  const byPilot = new Map<string, { number: string; name: string; passages: typeof parsed.racePassages }>();
  for (const p of parsed.racePassages) {
    const key = normalizeNumber(p.number);
    if (!byPilot.has(key)) {
      byPilot.set(key, { number: p.number, name: p.name, passages: [] });
    }
    byPilot.get(key)!.passages.push(p);
  }

  const result = new Map<string, LapPilotResult>();
  for (const [key, data] of byPilot) {
    const completed = data.passages.filter((p) => p.lapTimeMs != null && p.lapTimeMs > 0);
    if (completed.length === 0) continue;

    const lapCounts = completed
      .map((p) => p.lapsCount)
      .filter((n): n is number => n != null && n > 0);
    const laps = lapCounts.length > 0 ? Math.max(...lapCounts) : completed.length;

    const last = completed[completed.length - 1];
    let totalTimeMs = last.elapsedMs ?? 0;
    if (totalTimeMs <= 0 && completed.length >= 2) {
      totalTimeMs = completed[completed.length - 1].tmPasosMs - completed[0].tmPasosMs;
    }
    if (totalTimeMs <= 0 && last.lapTimeMs) {
      totalTimeMs = last.lapTimeMs;
    }

    result.set(key, {
      number: data.number,
      name: data.name,
      laps,
      totalTimeMs: Math.max(0, totalTimeMs),
    });
  }
  return result;
}

function enrichLap(
  pilots: Pilot[],
  number: string,
  name: string,
  laps: number,
  totalTimeMs: number,
  part: TestPart
): ResultRow {
  const expected = part.expectedLaps ?? null;
  const row = enrich(
    pilots,
    number,
    name,
    totalTimeMs,
    `Vueltas (${laps}${expected != null ? ` / ${expected}` : ""})`,
    part
  );
  return {
    ...row,
    laps,
    expectedLaps: expected,
    lapsIncomplete: expected != null && laps < expected,
  };
}

function rankLapRaw(rows: ResultRow[]): ResultRow[] {
  const sorted = [...rows].sort((a, b) => {
    const lapsA = a.laps ?? 0;
    const lapsB = b.laps ?? 0;
    if (lapsB !== lapsA) return lapsB - lapsA;
    return a.rawTimeMs - b.rawTimeMs;
  });
  return sorted.map((r, i) => ({ ...r, position: i + 1 }));
}

function isLapScoring(part: TestPart): boolean {
  return part.combinedMode && part.combinedScoring === "laps";
}

export function isLapScoringPart(part: TestPart): boolean {
  return isLapScoring(part);
}

export interface LapByLapRow {
  position: number;
  number: string;
  name: string;
  category: string;
  league: string;
  lapTimesFormatted: string[];
  lapClockTimesFormatted: string[];
  lapsCompleted: number;
  expectedLaps: number | null;
  totalTimeFormatted: string;
  totalTimeMs: number;
}

function lapDetailsByPilot(
  parsed: ParsedCsv
): Map<string, { lapTimeFormatted: string; clockFormatted: string }[]> {
  const map = new Map<string, { lapTimeFormatted: string; clockFormatted: string }[]>();
  for (const p of parsed.racePassages) {
    if (p.lapTimeMs == null || p.lapTimeMs <= 0) continue;
    const key = normalizeNumber(p.number);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({
      lapTimeFormatted: formatMs(p.lapTimeMs),
      clockFormatted: p.tmPasosRaw?.trim() || formatMs(p.tmPasosMs, true),
    });
  }
  return map;
}

export function computeLapByLapResults(
  event: Event,
  test: Test,
  part: TestPart,
  fromPointId?: string,
  toPointId?: string
): { rows: LapByLapRow[]; maxLaps: number; warning?: string } {
  if (!isLapScoring(part)) {
    return {
      rows: [],
      maxLaps: 0,
      warning: "Solo disponible para CSV único clasificado por vueltas.",
    };
  }

  const slot = part.csvs[0];
  if (!slot) {
    return { rows: [], maxLaps: 0, warning: "No hay CSV cargado en esta parte." };
  }

  const pilots = event.pilots || [];
  const summary = lapResultsByPilot(slot.parsed);
  const lapDetails = lapDetailsByPilot(slot.parsed);
  const expected = part.expectedLaps ?? null;

  let rows: LapByLapRow[] = [];
  for (const [key, s] of summary) {
    const details = lapDetails.get(key) || [];
    const pilot = pilots.find((p) => normalizeNumber(p.number) === key);
    rows.push({
      position: 0,
      number: s.number,
      name: pilot?.name || s.name,
      category: pilot?.category || "",
      league: pilot?.league || "",
      lapTimesFormatted: details.map((d) => d.lapTimeFormatted),
      lapClockTimesFormatted: details.map((d) => d.clockFormatted),
      lapsCompleted: s.laps,
      expectedLaps: expected,
      totalTimeFormatted: formatMs(s.totalTimeMs),
      totalTimeMs: s.totalTimeMs,
    });
  }

  const { fromId, toId } = resolveTestTimingPoints(event, test, fromPointId, toPointId);
  const { rows: partRows } = computePartResults(event, test, part, fromId, toId);
  const { rows: filteredPartRows } = filterNewPilotsVsEarlier(
    event,
    test,
    part,
    partRows,
    fromId,
    toId
  );
  const allowed = new Set(filteredPartRows.map((r) => normalizeNumber(r.number)));
  rows = rows.filter((r) => allowed.has(normalizeNumber(r.number)));

  rows.sort((a, b) => {
    if (b.lapsCompleted !== a.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
    return a.totalTimeMs - b.totalTimeMs;
  });
  rows.forEach((r, i) => {
    r.position = i + 1;
  });

  const maxLaps = Math.max(expected ?? 0, ...rows.map((r) => r.lapTimesFormatted.length), 0);

  if (rows.length === 0) {
    return { rows: [], maxLaps: 0, warning: "No se encontraron vueltas completadas en el CSV." };
  }

  return { rows, maxLaps };
}

function compareLapResultRows(a: ResultRow, b: ResultRow): number {
  const lapsA = a.laps ?? 0;
  const lapsB = b.laps ?? 0;
  if (lapsB !== lapsA) return lapsB - lapsA;
  return a.rawTimeMs - b.rawTimeMs;
}

function correctedTime(rawMs: number, point: TimingPoint | undefined): number {
  return rawMs - (point?.offsetMs ?? 0);
}

/**
 * Penalties are shared per pilot within a test (any salida + unified).
 * Legacy data may have multiple scopes; we merge them.
 */
function findPenalty(
  penalties: PilotPenalty[] | undefined,
  number: string
): PilotPenalty | undefined {
  const key = normalizeNumber(number);
  const matches = (penalties || []).filter((p) => normalizeNumber(p.number) === key);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  return {
    number: matches[0].number,
    scope: SHARED_PENALTY_SCOPE,
    timePenaltyMs: Math.max(...matches.map((m) => m.timePenaltyMs || 0)),
    positionPenalty: Math.max(...matches.map((m) => m.positionPenalty || 0)),
    comment: matches.map((m) => m.comment || "").find((c) => c.trim()) || "",
  };
}

function enrich(
  pilots: Pilot[],
  number: string,
  name: string,
  timeMs: number,
  segmentLabel: string,
  part?: TestPart
): ResultRow {
  const pilot = pilots.find((p) => normalizeNumber(p.number) === normalizeNumber(number));
  return {
    position: 0,
    number,
    name: pilot?.name || name,
    category: pilot?.category || "",
    league: pilot?.league || "",
    rawTimeMs: timeMs,
    rawTimeFormatted: formatMs(timeMs),
    timeMs,
    timeFormatted: formatMs(timeMs),
    timePenaltyMs: 0,
    positionPenalty: 0,
    comment: "",
    hasPenalty: false,
    partId: part?.id,
    partName: part?.name,
    missingPilot: !pilot,
    segmentLabel,
    incomplete: false,
  };
}

function enrichIncomplete(
  pilots: Pilot[],
  number: string,
  name: string,
  reason: "missing_start" | "missing_finish",
  fromLabel: string,
  toLabel: string,
  part?: TestPart
): ResultRow {
  const statusLabel =
    reason === "missing_finish"
      ? `Incompleto: sin llegada (${toLabel})`
      : `Incompleto: sin salida (${fromLabel})`;
  const row = enrich(pilots, number, name, 0, statusLabel, part);
  return {
    ...row,
    rawTimeFormatted: "—",
    timeFormatted: "—",
    incomplete: true,
    incompleteReason: reason,
    statusLabel,
  };
}

function partsInOrder(test: Test): TestPart[] {
  return [...test.parts].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function earlierParts(test: Test, part: TestPart): TestPart[] {
  const ordered = partsInOrder(test);
  const idx = ordered.findIndex((p) => p.id === part.id);
  if (idx <= 0) return [];
  return ordered.slice(0, idx);
}

type Passage = { number: string; name: string; tm: number; lap: number | null };

/** Look for start (Desde) in earlier salidas when current only has finish */
function findEarlierFromPassage(
  event: Event,
  test: Test,
  currentPart: TestPart,
  fromId: string,
  pilotKey: string
): { passage: Passage; part: TestPart; point: TimingPoint | undefined } | null {
  const points = event.timingPoints;
  // Most recent earlier salida first (still closing the previous wave)
  for (const prev of [...earlierParts(test, currentPart)].reverse()) {
    const slot = prev.csvs.find((c) => c.timingPointId === fromId);
    if (!slot) continue;
    const map = firstRacePassageByPilot(slot.parsed);
    const passage = map.get(pilotKey);
    if (passage) {
      return {
        passage,
        part: prev,
        point: points.find((p) => p.id === fromId),
      };
    }
  }
  return null;
}

function mergeCompleteAndIncomplete(
  complete: ResultRow[],
  incomplete: ResultRow[],
  penalties: PilotPenalty[] | undefined,
  scope: string
): ResultRow[] {
  const ranked = applyPenalties(rankRaw(complete), penalties, scope);
  const incompleteOut = incomplete.map((r) => {
    const pen = findPenalty(penalties, r.number);
    return {
      ...r,
      position: 0,
      timePenaltyMs: pen?.timePenaltyMs || 0,
      positionPenalty: pen?.positionPenalty || 0,
      comment: pen?.comment || "",
      hasPenalty: Boolean(
        (pen?.timePenaltyMs || 0) > 0 ||
          (pen?.positionPenalty || 0) > 0 ||
          (pen?.comment || "").trim()
      ),
    };
  });
  return [...ranked, ...incompleteOut];
}

/** Apply time + position penalties and re-rank */
export function applyPenalties(
  rows: ResultRow[],
  penalties: PilotPenalty[] | undefined,
  _scope?: string
): ResultRow[] {
  const withTime = rows.map((r) => {
    const pen = findPenalty(penalties, r.number);
    const timePenaltyMs = pen?.timePenaltyMs || 0;
    const positionPenalty = pen?.positionPenalty || 0;
    const comment = pen?.comment || "";
    const timeMs = r.rawTimeMs + timePenaltyMs;
    const hasPenalty = timePenaltyMs !== 0 || positionPenalty !== 0 || Boolean(comment.trim());
    return {
      ...r,
      timePenaltyMs,
      positionPenalty,
      comment,
      hasPenalty,
      timeMs,
      timeFormatted: formatMs(timeMs),
    };
  });

  const lapMode = withTime.some((r) => r.laps != null && r.laps > 0);

  const byScore = [...withTime].sort((a, b) => {
    if (lapMode) {
      const lapsA = a.laps ?? 0;
      const lapsB = b.laps ?? 0;
      if (lapsB !== lapsA) return lapsB - lapsA;
    }
    return a.timeMs - b.timeMs;
  });

  const provisional = byScore.map((r, i) => ({
    ...r,
    _sort: i + 1 + (r.positionPenalty || 0),
  }));

  provisional.sort((a, b) => {
    if (lapMode) {
      const lapsA = a.laps ?? 0;
      const lapsB = b.laps ?? 0;
      if (lapsB !== lapsA) return lapsB - lapsA;
    }
    return a._sort - b._sort || a.timeMs - b.timeMs;
  });

  return provisional.map(({ _sort, ...r }, i) => ({
    ...r,
    position: i + 1,
  }));
}

function rankRaw(rows: ResultRow[]): ResultRow[] {
  const sorted = [...rows].sort((a, b) => a.rawTimeMs - b.rawTimeMs);
  return sorted.map((r, i) => ({ ...r, position: i + 1 }));
}

export interface ResultsComputation {
  rows: ResultRow[];
  warning?: string;
  scope: string;
  /** Present when partial results exclude pilots already seen in earlier salidas */
  diffNote?: string;
}

/**
 * For cumulative CSV dumps (salida N includes all of N-1 + new pilots),
 * keep only pilots that did not appear with a complete time in any earlier salida.
 * Incomplete (solo A o solo B) do not count as "already listed".
 */
export function filterNewPilotsVsEarlier(
  event: Event,
  test: Test,
  part: TestPart,
  rows: ResultRow[],
  fromPointId?: string,
  toPointId?: string
): { rows: ResultRow[]; diffNote?: string } {
  const earlier = earlierParts(test, part);
  if (earlier.length === 0 || rows.length === 0) {
    return { rows };
  }

  const seen = new Set<string>();
  const comparedNames: string[] = [];
  for (const prev of earlier) {
    const raw = computePartResultsRaw(event, test, prev, fromPointId, toPointId);
    const completePrev = raw.rows.filter((r) => !r.incomplete);
    if (completePrev.length === 0) continue;
    comparedNames.push(prev.name);
    for (const r of completePrev) seen.add(normalizeNumber(r.number));
  }

  if (seen.size === 0) {
    return { rows };
  }

  const onlyNew = rows.filter((r) => !seen.has(normalizeNumber(r.number)));
  const excluded = rows.length - onlyNew.length;
  const complete = onlyNew.filter((r) => !r.incomplete);
  const incomplete = onlyNew.filter((r) => r.incomplete);
  const reranked = [
    ...complete.map((r, i) => ({ ...r, position: i + 1 })),
    ...incomplete.map((r) => ({ ...r, position: 0 })),
  ];

  const vs =
    comparedNames.length === 1
      ? comparedNames[0]
      : comparedNames.length > 1
        ? `salidas anteriores (${comparedNames.join(", ")})`
        : "salidas anteriores";

  return {
    rows: reranked,
    diffNote:
      excluded > 0
        ? `Solo diferencia vs ${vs}: ${reranked.length} piloto(s) nuevo(s)/pendiente(s), ${excluded} ya con tiempo completo antes.`
        : `Sin pilotos nuevos vs ${vs} (todos ya tenían tiempo completo en salidas anteriores).`,
  };
}

export function computePartResults(
  event: Event,
  test: Test,
  part: TestPart,
  fromPointId?: string,
  toPointId?: string
): ResultsComputation {
  const points = [...event.timingPoints].sort((a, b) => a.order - b.order);
  const pilots = event.pilots || [];
  const scope = part.id;

  if (part.combinedMode) {
    const slot = part.csvs[0];
    if (!slot) return { rows: [], warning: "No hay CSV cargado en esta parte.", scope };

    if (isLapScoring(part)) {
      const byPilot = lapResultsByPilot(slot.parsed);
      const rows: ResultRow[] = [];
      for (const [, p] of byPilot) {
        rows.push(enrichLap(pilots, p.number, p.name, p.laps, p.totalTimeMs, part));
      }
      if (rows.length === 0) {
        return {
          rows: [],
          warning:
            "No se encontraron vueltas completadas (Tiempo de vuelta > 0) en el CSV.",
          scope,
        };
      }
      return { rows: applyPenalties(rankLapRaw(rows), test.penalties, scope), scope };
    }

    const byPilot = firstLapPassageByPilot(slot.parsed);
    const rows: ResultRow[] = [];
    for (const [, p] of byPilot) {
      rows.push(enrich(pilots, p.number, p.name, p.lap, "CSV combinado (Tiempo de vuelta)", part));
    }
    if (rows.length === 0) {
      return {
        rows: [],
        warning:
          "No se encontraron tiempos de vuelta (> 0) en el CSV. Si usas dos puntos, cambia a modo CSV por punto.",
        scope,
      };
    }
    return { rows: applyPenalties(rankRaw(rows), test.penalties, scope), scope };
  }

  const fromId = fromPointId ?? points[0]?.id;
  const toId = toPointId ?? points[1]?.id;
  if (!fromId || !toId) {
    return { rows: [], warning: "Selecciona puntos de cronometraje Desde y Hasta.", scope };
  }
  if (fromId === toId) {
    return { rows: [], warning: "Los puntos Desde y Hasta deben ser diferentes.", scope };
  }

  const fromSlot = part.csvs.find((c) => c.timingPointId === fromId);
  const toSlot = part.csvs.find((c) => c.timingPointId === toId);
  const fromPoint = points.find((p) => p.id === fromId);
  const toPoint = points.find((p) => p.id === toId);
  const fromLabel = fromPoint?.name ?? "Desde";
  const toLabel = toPoint?.name ?? "Hasta";

  if (!fromSlot && !toSlot) {
    return { rows: [], warning: `Falta cargar los CSV de ${fromLabel} y ${toLabel}.`, scope };
  }

  const fromMap = fromSlot
    ? firstRacePassageByPilot(fromSlot.parsed)
    : new Map<string, Passage>();
  const toMap = toSlot ? firstRacePassageByPilot(toSlot.parsed) : new Map<string, Passage>();

  if (fromMap.size === 0 && toMap.size === 0) {
    return {
      rows: [],
      warning:
        "Uno o ambos CSV no tienen pasadas de carrera válidas (N° + Tm de pasos dentro de bandera verde).",
      scope,
    };
  }

  const complete: ResultRow[] = [];
  const incomplete: ResultRow[] = [];
  let nonPositive = 0;
  const allKeys = new Set<string>([...fromMap.keys(), ...toMap.keys()]);

  for (const key of allKeys) {
    const from = fromMap.get(key);
    const to = toMap.get(key);

    if (from && to) {
      const tFrom = correctedTime(from.tm, fromPoint);
      const tTo = correctedTime(to.tm, toPoint);
      const delta = tTo - tFrom;
      if (delta <= 0) {
        nonPositive++;
        continue;
      }
      complete.push(
        enrich(
          pilots,
          from.number,
          pickName(from.name, to.name),
          delta,
          `${fromLabel} → ${toLabel}`,
          part
        )
      );
      continue;
    }

    if (from && !to) {
      incomplete.push(
        enrichIncomplete(
          pilots,
          from.number,
          from.name,
          "missing_finish",
          fromLabel,
          toLabel,
          part
        )
      );
      continue;
    }

    if (!from && to) {
      const earlierFrom = findEarlierFromPassage(event, test, part, fromId, key);
      if (earlierFrom) {
        const tFrom = correctedTime(earlierFrom.passage.tm, earlierFrom.point);
        const tTo = correctedTime(to.tm, toPoint);
        const delta = tTo - tFrom;
        if (delta <= 0) {
          nonPositive++;
          continue;
        }
        complete.push(
          enrich(
            pilots,
            to.number,
            pickName(to.name, earlierFrom.passage.name),
            delta,
            `${fromLabel} (${earlierFrom.part.name}) → ${toLabel} (${part.name})`,
            part
          )
        );
      } else {
        incomplete.push(
          enrichIncomplete(pilots, to.number, to.name, "missing_start", fromLabel, toLabel, part)
        );
      }
    }
  }

  if (complete.length === 0 && incomplete.length === 0) {
    if (nonPositive > 0) {
      return {
        rows: [],
        warning: `Se emparejaron piloto(s), pero todos los tiempos salieron ≤ 0 tras aplicar desfases. Revisa los desfases de los puntos de cronometraje (relativos a PC A).`,
        scope,
      };
    }
    return {
      rows: [],
      warning: "No hay pasadas válidas para emparejar entre los CSV.",
      scope,
    };
  }

  return {
    rows: mergeCompleteAndIncomplete(complete, incomplete, test.penalties, scope),
    scope,
  };
}

export function computeTestResults(
  event: Event,
  test: Test,
  fromPointId?: string,
  toPointId?: string
): ResultsComputation {
  const best = new Map<string, ResultRow>();
  const warnings: string[] = [];
  const scope = UNIFIED_SCOPE;

  if (test.parts.length === 0) {
    return { rows: [], warning: "La prueba no tiene partes/salidas.", scope };
  }

  for (const part of test.parts) {
    // Best raw time across salidas; shared penalties applied after selection
    const raw = computePartResultsRaw(event, test, part, fromPointId, toPointId);
    if (raw.warning) warnings.push(`${part.name}: ${raw.warning}`);
    for (const row of raw.rows) {
      if (row.incomplete) continue;
      const key = normalizeNumber(row.number);
      const prev = best.get(key);
      if (!prev) {
        best.set(key, { ...row, partId: part.id, partName: part.name });
        continue;
      }
      const better =
        isLapScoring(part) || (prev.laps != null && row.laps != null)
          ? compareLapResultRows(row, prev) < 0
          : row.rawTimeMs < prev.rawTimeMs;
      if (better) {
        best.set(key, { ...row, partId: part.id, partName: part.name });
      }
    }
  }

  const values = [...best.values()];
  const useLapRank = values.some((r) => r.laps != null && r.laps > 0);
  const rows = applyPenalties(
    useLapRank ? rankLapRaw(values) : rankRaw(values),
    test.penalties,
    scope
  );
  if (rows.length === 0) {
    return {
      rows: [],
      warning: warnings[0] || "No hay resultados unificados para esta prueba.",
      scope,
    };
  }
  return { rows, scope };
}

/** Part results without applying penalties (for unified / diff). Keeps lookback across salidas. */
function computePartResultsRaw(
  event: Event,
  test: Test,
  part: TestPart,
  fromPointId?: string,
  toPointId?: string
): { rows: ResultRow[]; warning?: string } {
  const noPenalties: Test = { ...test, penalties: [] };
  const { rows, warning } = computePartResults(event, noPenalties, part, fromPointId, toPointId);
  return { rows, warning };
}

export function upsertPenalty(
  test: Test,
  input: {
    number: string;
    scope?: string;
    timePenaltyMs?: number;
    positionPenalty?: number;
    comment?: string;
  }
): Test {
  const number = String(input.number || "").trim();
  if (!number) throw new Error("N° de piloto requerido");

  const timePenaltyMs = Math.max(0, Math.round(input.timePenaltyMs || 0));
  const positionPenalty = Math.max(0, Math.round(input.positionPenalty || 0));
  const comment = (input.comment || "").trim();

  // One penalty per pilot for the whole test (shared across salidas + unificado)
  const penalties = (test.penalties || []).filter(
    (p) => normalizeNumber(p.number) !== normalizeNumber(number)
  );

  const empty = timePenaltyMs === 0 && positionPenalty === 0 && !comment;
  if (!empty) {
    penalties.push({
      number,
      scope: SHARED_PENALTY_SCOPE,
      timePenaltyMs,
      positionPenalty,
      comment,
    });
  }

  test.penalties = penalties;
  return test;
}

export function getTest(event: Event, testId: string): Test | undefined {
  return event.tests.find((t) => t.id === testId);
}

export function getPart(test: Test, partId: string): TestPart | undefined {
  return test.parts.find((p) => p.id === partId);
}
