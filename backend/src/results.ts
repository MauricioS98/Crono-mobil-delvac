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

function correctedTime(rawMs: number, point: TimingPoint | undefined): number {
  return rawMs - (point?.offsetMs ?? 0);
}

function findPenalty(
  penalties: PilotPenalty[] | undefined,
  number: string,
  scope: string
): PilotPenalty | undefined {
  const key = normalizeNumber(number);
  return (penalties || []).find(
    (p) => normalizeNumber(p.number) === key && p.scope === scope
  );
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
  };
}

/** Apply time + position penalties and re-rank */
export function applyPenalties(
  rows: ResultRow[],
  penalties: PilotPenalty[] | undefined,
  scope: string
): ResultRow[] {
  const withTime = rows.map((r) => {
    const pen = findPenalty(penalties, r.number, scope);
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

  const byTime = [...withTime].sort((a, b) => a.timeMs - b.timeMs);
  const provisional = byTime.map((r, i) => ({
    ...r,
    _sort: i + 1 + (r.positionPenalty || 0),
  }));

  provisional.sort((a, b) => a._sort - b._sort || a.timeMs - b.timeMs);

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
  if (!fromSlot || !toSlot) {
    const missing = [
      !fromSlot ? points.find((p) => p.id === fromId)?.name || "Desde" : null,
      !toSlot ? points.find((p) => p.id === toId)?.name || "Hasta" : null,
    ]
      .filter(Boolean)
      .join(" y ");
    return { rows: [], warning: `Falta cargar el CSV de: ${missing}.`, scope };
  }

  const fromPoint = points.find((p) => p.id === fromId);
  const toPoint = points.find((p) => p.id === toId);
  const fromMap = firstRacePassageByPilot(fromSlot.parsed);
  const toMap = firstRacePassageByPilot(toSlot.parsed);

  if (fromMap.size === 0 || toMap.size === 0) {
    return {
      rows: [],
      warning:
        "Uno o ambos CSV no tienen pasadas de carrera válidas (N° + Tm de pasos dentro de bandera verde).",
      scope,
    };
  }

  const rows: ResultRow[] = [];
  let matched = 0;
  let nonPositive = 0;

  for (const [key, from] of fromMap) {
    const to = toMap.get(key);
    if (!to) continue;
    matched++;
    const tFrom = correctedTime(from.tm, fromPoint);
    const tTo = correctedTime(to.tm, toPoint);
    const delta = tTo - tFrom;
    if (delta <= 0) {
      nonPositive++;
      continue;
    }
    rows.push(
      enrich(
        pilots,
        from.number,
        pickName(from.name, to.name),
        delta,
        `${fromPoint?.name ?? "A"} → ${toPoint?.name ?? "B"}`,
        part
      )
    );
  }

  if (rows.length === 0) {
    if (matched === 0) {
      return { rows: [], warning: "No hay pilotos en común (mismo N°) entre ambos CSV.", scope };
    }
    if (nonPositive > 0) {
      return {
        rows: [],
        warning: `Se emparejaron ${matched} piloto(s), pero todos los tiempos salieron ≤ 0 tras aplicar desfases. Revisa los desfases de los puntos de cronometraje (relativos a PC A).`,
        scope,
      };
    }
  }

  return { rows: applyPenalties(rankRaw(rows), test.penalties, scope), scope };
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
    // Raw part results without part-scope penalties — unified has its own penalties
    const raw = computePartResultsRaw(event, part, fromPointId, toPointId);
    if (raw.warning) warnings.push(`${part.name}: ${raw.warning}`);
    for (const row of raw.rows) {
      const key = normalizeNumber(row.number);
      const prev = best.get(key);
      if (!prev || row.rawTimeMs < prev.rawTimeMs) {
        best.set(key, { ...row, partId: part.id, partName: part.name });
      }
    }
  }

  const rows = applyPenalties(rankRaw([...best.values()]), test.penalties, scope);
  if (rows.length === 0) {
    return {
      rows: [],
      warning: warnings[0] || "No hay resultados unificados para esta prueba.",
      scope,
    };
  }
  return { rows, scope };
}

/** Part results without applying penalties (for unified best-time selection) */
function computePartResultsRaw(
  event: Event,
  part: TestPart,
  fromPointId?: string,
  toPointId?: string
): { rows: ResultRow[]; warning?: string } {
  const fakeTest: Test = {
    id: "",
    name: "",
    description: "",
    showDescriptionInPdf: false,
    order: 0,
    parts: [],
    penalties: [],
  };
  const { rows, warning } = computePartResults(event, fakeTest, part, fromPointId, toPointId);
  // computePartResults with empty penalties still applies applyPenalties with no effect
  return { rows, warning };
}

export function upsertPenalty(
  test: Test,
  input: {
    number: string;
    scope: string;
    timePenaltyMs?: number;
    positionPenalty?: number;
    comment?: string;
  }
): Test {
  const number = String(input.number || "").trim();
  const scope = String(input.scope || UNIFIED_SCOPE);
  if (!number) throw new Error("N° de piloto requerido");

  const timePenaltyMs = Math.max(0, Math.round(input.timePenaltyMs || 0));
  const positionPenalty = Math.max(0, Math.round(input.positionPenalty || 0));
  const comment = (input.comment || "").trim();

  const penalties = [...(test.penalties || [])];
  const idx = penalties.findIndex(
    (p) => normalizeNumber(p.number) === normalizeNumber(number) && p.scope === scope
  );

  const empty = timePenaltyMs === 0 && positionPenalty === 0 && !comment;
  if (empty) {
    if (idx >= 0) penalties.splice(idx, 1);
  } else {
    const entry: PilotPenalty = { number, scope, timePenaltyMs, positionPenalty, comment };
    if (idx >= 0) penalties[idx] = entry;
    else penalties.push(entry);
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
