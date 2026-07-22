import { v4 as uuid } from "uuid";
import type { Pilot } from "./types.js";
import { normalizeNumber } from "./storage.js";

export type PilotMapField =
  | "number"
  | "firstName"
  | "lastName"
  | "category"
  | "league"
  | "moto"
  | "club"
  | "doc"
  | "phone"
  | "none";

export type ColumnMapping = Partial<Record<Exclude<PilotMapField, "none">, number>>;

export const PILOT_MAP_FIELDS: { key: Exclude<PilotMapField, "none">; label: string; required?: boolean }[] = [
  { key: "number", label: "Nº", required: true },
  { key: "firstName", label: "Nombre" },
  { key: "lastName", label: "Apellido/s" },
  { key: "category", label: "Clase" },
  { key: "league", label: "Liga" },
  { key: "moto", label: "Moto" },
  { key: "club", label: "Club" },
  { key: "doc", label: "Doc/EPS" },
  { key: "phone", label: "Cel/Email" },
];

function detectDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function parseLine(line: string, delimiter: string): string[] {
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
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const SUGGESTIONS: Record<Exclude<PilotMapField, "none">, string[]> = {
  number: ["no", "n°", "nº", "numero", "number", "#", "num"],
  firstName: ["firstname", "first name", "nombre", "piloto"],
  lastName: ["lastname", "last name", "apellido", "apellidos", "apellido/s"],
  category: ["class", "clase", "categoria", "category"],
  league: ["additional1", "liga", "league", "pais", "departamento"],
  moto: ["additional3", "moto", "marca", "bike"],
  club: ["additional5", "club", "equipo", "team"],
  doc: ["additional4", "doc", "eps", "documento", "cedula"],
  phone: ["additional8", "cel", "email", "telefono", "celular", "mail"],
};

export interface CsvPreview {
  filename: string;
  delimiter: string;
  columns: { index: number; label: string; header: string }[];
  /** Header order as readable text */
  headerOrder: string;
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  totalDataRows: number;
}

export function previewPilotsCsv(content: string, filename = "archivo.csv"): CsvPreview {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) throw new Error("El archivo está vacío");

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseLine(lines[0], delimiter);
  const columns = headers.map((header, index) => ({
    index,
    header,
    label: `${index + 1}. ${header || `(columna ${index + 1})`}`,
  }));

  const headerOrder = columns.map((c) => c.label).join("  ·  ");

  const suggestedMapping: ColumnMapping = {};
  for (const field of PILOT_MAP_FIELDS) {
    const aliases = SUGGESTIONS[field.key];
    const idx = headers.findIndex((h) => aliases.includes(normalizeHeader(h)));
    if (idx >= 0) suggestedMapping[field.key] = idx;
  }

  const sampleRows = lines.slice(1, 6).map((l) => parseLine(l, delimiter));

  return {
    filename,
    delimiter,
    columns,
    headerOrder,
    sampleRows,
    suggestedMapping,
    totalDataRows: Math.max(0, lines.length - 1),
  };
}

export interface PilotsImportResult {
  pilots: Pilot[];
  added: number;
  updated: number;
  skipped: number;
}

function cell(cols: string[], index: number | undefined): string {
  if (index == null || index < 0) return "";
  return (cols[index] ?? "").trim();
}

/**
 * Import pilots using an explicit column mapping (by index).
 * Header names are irrelevant; only the selected column indexes matter.
 */
export function importPilotsFromCsv(
  content: string,
  existing: Pilot[],
  mapping: ColumnMapping,
  options?: { skipFirstRow?: boolean }
): PilotsImportResult {
  const skipFirstRow = options?.skipFirstRow !== false;
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) throw new Error("El archivo está vacío");
  if (mapping.number == null || mapping.number < 0) {
    throw new Error("Debes mapear la columna Nº");
  }

  const delimiter = detectDelimiter(lines[0]);
  const start = skipFirstRow ? 1 : 0;
  if (start >= lines.length) throw new Error("El archivo no tiene filas de pilotos");

  const byNumber = new Map<string, Pilot>();
  for (const p of existing) {
    byNumber.set(normalizeNumber(p.number), p);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const cols = parseLine(lines[i], delimiter);
    const number = cell(cols, mapping.number);
    if (!number) {
      skipped++;
      continue;
    }

    const first = cell(cols, mapping.firstName);
    const last = cell(cols, mapping.lastName);
    const name = [first, last].filter(Boolean).join(" ").trim();
    const category = cell(cols, mapping.category);
    const league = cell(cols, mapping.league);
    const moto = cell(cols, mapping.moto);
    const club = cell(cols, mapping.club);
    const doc = cell(cols, mapping.doc);
    const phone = cell(cols, mapping.phone);
    const notes = [
      club && `Club: ${club}`,
      moto && `Moto: ${moto}`,
      doc && `Doc: ${doc}`,
      phone && `Contacto: ${phone}`,
    ]
      .filter(Boolean)
      .join(" · ");

    const key = normalizeNumber(number);
    const prev = byNumber.get(key);
    if (prev) {
      byNumber.set(key, {
        ...prev,
        number,
        name: name || prev.name,
        category: category || prev.category,
        league: league || prev.league,
        notes: notes || prev.notes || "",
      });
      updated++;
    } else {
      byNumber.set(key, {
        id: uuid(),
        number,
        name,
        category,
        league,
        notes,
      });
      added++;
    }
  }

  return {
    pilots: [...byNumber.values()].sort((a, b) =>
      normalizeNumber(a.number).localeCompare(normalizeNumber(b.number), undefined, { numeric: true })
    ),
    added,
    updated,
    skipped,
  };
}
