import type { FlagEvent, FlagType, ParsedCsv, Passage } from "./types.js";
import { parseTimeToMs } from "./timeUtils.js";

function classifyFlag(nombre: string, numero: string): FlagType | null {
  const n = nombre.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const num = numero.trim();

  if (/manual\s*no\s*asignado/i.test(n) || num === "??") return "manual";
  if (/bandera\s*de\s*calentamiento|bandera\s*morada|calentamiento/i.test(n)) return "warmup";
  if (/bandera\s*verde/i.test(n)) return "green";
  if (/bandera\s*de\s*finalizacion|bandera\s*a\s*cuadros|cuadros|checkered|finalizaci/i.test(n)) {
    return "checkered";
  }
  if (/carrera\s*parada/i.test(n)) return "stopped";
  if (!num && n) return "other";
  return null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function findCol(headers: string[], ...names: string[]): number {
  const normalized = headers.map((h) =>
    h.replace(/^\uFEFF/, "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  );
  // Prefer exact header match first (avoids "Nombre" matching "no", etc.)
  for (const name of names) {
    const target = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const exact = normalized.findIndex((h) => h === target);
    if (exact >= 0) return exact;
  }
  for (const name of names) {
    const target = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    // Only allow includes for longer targets to avoid false positives
    if (target.length < 4) continue;
    const idx = normalized.findIndex((h) => h.includes(target));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Extract race windows: from each Bandera Verde until Carrera parada / end,
 * including checkered (last pass at finish still counts).
 */
export function extractRacePassages(passages: Passage[], flags: FlagEvent[]): Passage[] {
  if (flags.length === 0) {
    // No flags → use all pilot passages
    return [...passages];
  }

  const timeline = [
    ...passages.map((p) => ({ kind: "passage" as const, ms: p.tmPasosMs, passage: p })),
    ...flags.map((f) => ({ kind: "flag" as const, ms: f.tmPasosMs, flag: f })),
  ].sort((a, b) => a.ms - b.ms || (a.kind === "flag" ? -1 : 1));

  const racePassages: Passage[] = [];
  let inRace = false;
  let sawGreen = false;

  for (const item of timeline) {
    if (item.kind === "flag") {
      if (item.flag.type === "green") {
        inRace = true;
        sawGreen = true;
      } else if (item.flag.type === "stopped") {
        inRace = false;
      } else if (item.flag.type === "checkered") {
        // Checkered marks last finish pass window; keep collecting until stopped or end
        inRace = true;
        sawGreen = true;
      }
      // warmup / other / manual: do not start race
      continue;
    }
    if (inRace) {
      racePassages.push(item.passage);
    }
  }

  // If there was never a green flag, fall back to all passages
  if (!sawGreen) return [...passages];
  return racePassages;
}

export function parseTimingCsv(content: string, filename: string): ParsedCsv {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { filename, passages: [], flags: [], racePassages: [] };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const colNum = findCol(headers, "n°", "nº", "no", "numero", "#");
  // Prefer exact N° over the leading "#" column
  const colNumero =
    headers.findIndex((h) => /^n[°ºo]?$/i.test(h.trim()) || h.trim() === "N°") >= 0
      ? headers.findIndex((h) => /^n[°ºo]?$/i.test(h.trim()) || h.trim() === "N°")
      : colNum;
  const colNombre = findCol(headers, "nombre");
  const colTm = findCol(headers, "tm de pasos", "tm pasos");
  const colLap = findCol(headers, "tiempo de vuelta");
  const colClase = findCol(headers, "clase");
  const colLaps = findCol(headers, "vueltas");
  const colElapsed = findCol(
    headers,
    "t° transcurrido",
    "t transcurrido",
    "tiempo transcurrido",
    "tempo transcurrido"
  );
  const colBorrado = findCol(headers, "borrado");

  if (colNumero < 0 || colTm < 0) {
    throw new Error('El CSV debe contener las columnas "N°" y "Tm de pasos"');
  }

  const isDeleted = (raw: string) => {
    const v = raw.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return v === "yes" || v === "si" || v === "true" || v === "1" || v === "y";
  };

  const passages: Passage[] = [];
  const flags: FlagEvent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const numero = (cols[colNumero] ?? "").trim();
    const nombre = colNombre >= 0 ? (cols[colNombre] ?? "").trim() : "";
    const tmRaw = (cols[colTm] ?? "").trim();
    const lapRaw = colLap >= 0 ? (cols[colLap] ?? "").trim() : "";
    const lapsRaw = colLaps >= 0 ? (cols[colLaps] ?? "").trim() : "";
    const elapsedRaw = colElapsed >= 0 ? (cols[colElapsed] ?? "").trim() : "";
    const clase = colClase >= 0 ? (cols[colClase] ?? "").trim() : "";
    const borradoRaw = colBorrado >= 0 ? (cols[colBorrado] ?? "").trim() : "";
    const tmMs = parseTimeToMs(tmRaw);
    if (tmMs === null) continue;

    // Soft-deleted hits must not count toward timing
    if (colBorrado >= 0 && isDeleted(borradoRaw)) continue;

    const flagType = classifyFlag(nombre, numero);
    if (flagType === "manual") continue;

    if (flagType && flagType !== "other") {
      flags.push({
        type: flagType,
        tmPasosMs: tmMs,
        tmPasosRaw: tmRaw,
        label: nombre,
        rowIndex: i,
      });
      continue;
    }

    // Rows without a number are event markers, not pilots. Pilot names are optional.
    if (!numero) {
      if (flagType === "other") {
        flags.push({
          type: "other",
          tmPasosMs: tmMs,
          tmPasosRaw: tmRaw,
          label: nombre,
          rowIndex: i,
        });
      }
      continue;
    }

    const lapMs = parseTimeToMs(lapRaw);
    const hasLap = lapRaw !== "" && lapRaw !== "0" && lapRaw !== "0.0" && lapRaw !== "0,0" && lapMs !== null && lapMs > 0;
    const lapsCount = lapsRaw !== "" ? Number(lapsRaw) : null;
    const elapsedMs = elapsedRaw ? parseTimeToMs(elapsedRaw) : null;

    passages.push({
      number: numero,
      name: nombre,
      tmPasosMs: tmMs,
      tmPasosRaw: tmRaw,
      lapTimeMs: hasLap ? lapMs : null,
      lapTimeRaw: lapRaw,
      lapsCount: lapsCount != null && !Number.isNaN(lapsCount) ? Math.floor(lapsCount) : null,
      elapsedMs: elapsedMs ?? null,
      clase,
      rowIndex: i,
    });
  }

  const racePassages = extractRacePassages(passages, flags);

  return { filename, passages, flags, racePassages };
}
