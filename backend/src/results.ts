import { normalizeNumber } from "./storage.js";
import { formatMs } from "./timeUtils.js";
import type { Event, ParsedCsv, Pilot, ResultRow, Test, TestPart, TimingPoint } from "./types.js";

function pickName(a: string, b?: string): string {
  return a || b || "";
}

function firstRacePassageByPilot(parsed: ParsedCsv): Map<string, { number: string; name: string; tm: number; lap: number | null }> {
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

/** First race passage that already carries a lap time (combined CSV mode) */
function firstLapPassageByPilot(parsed: ParsedCsv): Map<string, { number: string; name: string; lap: number }> {
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
    timeMs,
    timeFormatted: formatMs(timeMs),
    partId: part?.id,
    partName: part?.name,
    missingPilot: !pilot,
    segmentLabel,
  };
}

function rank(rows: ResultRow[]): ResultRow[] {
  const sorted = [...rows].sort((a, b) => a.timeMs - b.timeMs);
  return sorted.map((r, i) => ({ ...r, position: i + 1 }));
}

export interface ResultsComputation {
  rows: ResultRow[];
  warning?: string;
}

/** Compute results for a part between two timing points (or combined CSV mode) */
export function computePartResults(
  event: Event,
  part: TestPart,
  fromPointId?: string,
  toPointId?: string
): ResultsComputation {
  const points = [...event.timingPoints].sort((a, b) => a.order - b.order);

  const pilots = event.pilots || [];

  if (part.combinedMode) {
    const slot = part.csvs[0];
    if (!slot) return { rows: [], warning: "No hay CSV cargado en esta parte." };
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
      };
    }
    return { rows: rank(rows) };
  }

  const fromId = fromPointId ?? points[0]?.id;
  const toId = toPointId ?? points[1]?.id;
  if (!fromId || !toId) {
    return { rows: [], warning: "Selecciona puntos de cronometraje Desde y Hasta." };
  }
  if (fromId === toId) {
    return { rows: [], warning: "Los puntos Desde y Hasta deben ser diferentes." };
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
    return { rows: [], warning: `Falta cargar el CSV de: ${missing}.` };
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
      return {
        rows: [],
        warning: "No hay pilotos en común (mismo N°) entre ambos CSV.",
      };
    }
    if (nonPositive > 0) {
      return {
        rows: [],
        warning: `Se emparejaron ${matched} piloto(s), pero todos los tiempos salieron ≤ 0 tras aplicar desfases. Revisa los desfases de los puntos de cronometraje (relativos a PC A).`,
      };
    }
  }

  return { rows: rank(rows) };
}

/** Unified results across all parts of a test (best time per pilot) */
export function computeTestResults(
  event: Event,
  test: Test,
  fromPointId?: string,
  toPointId?: string
): ResultsComputation {
  const best = new Map<string, ResultRow>();
  const warnings: string[] = [];

  if (test.parts.length === 0) {
    return { rows: [], warning: "La prueba no tiene partes/salidas." };
  }

  for (const part of test.parts) {
    const { rows: partRows, warning } = computePartResults(event, part, fromPointId, toPointId);
    if (warning) warnings.push(`${part.name}: ${warning}`);
    for (const row of partRows) {
      const key = normalizeNumber(row.number);
      const prev = best.get(key);
      if (!prev || row.timeMs < prev.timeMs) {
        best.set(key, { ...row, partId: part.id, partName: part.name });
      }
    }
  }

  const rows = rank([...best.values()]);
  if (rows.length === 0) {
    return {
      rows: [],
      warning: warnings[0] || "No hay resultados unificados para esta prueba.",
    };
  }
  return { rows };
}

export function getTest(event: Event, testId: string): Test | undefined {
  return event.tests.find((t) => t.id === testId);
}

export function getPart(test: Test, partId: string): TestPart | undefined {
  return test.parts.find((p) => p.id === partId);
}
