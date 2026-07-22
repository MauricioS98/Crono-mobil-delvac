export interface TimingPoint {
  id: string;
  name: string;
  /** Offset in milliseconds relative to the first timing point (reference) */
  offsetMs: number;
  order: number;
}

export interface Pilot {
  id: string;
  number: string;
  name: string;
  category: string;
  league: string;
  notes?: string;
}

export interface Passage {
  number: string;
  name: string;
  tmPasosMs: number;
  tmPasosRaw: string;
  lapTimeMs: number | null;
  lapTimeRaw: string;
  clase: string;
  rowIndex: number;
}

export type FlagType =
  | "warmup"
  | "green"
  | "checkered"
  | "stopped"
  | "manual"
  | "other";

export interface FlagEvent {
  type: FlagType;
  tmPasosMs: number;
  tmPasosRaw: string;
  label: string;
  rowIndex: number;
}

export interface ParsedCsv {
  filename: string;
  passages: Passage[];
  flags: FlagEvent[];
  /** Passages inside green → stopped/checkered windows */
  racePassages: Passage[];
}

export interface PartCsvSlot {
  timingPointId: string;
  filename: string;
  parsed: ParsedCsv;
}

export interface TestPart {
  id: string;
  name: string;
  order: number;
  /** When true, a single CSV already contains both times via Tiempo de vuelta */
  combinedMode: boolean;
  csvs: PartCsvSlot[];
}

export interface Test {
  id: string;
  name: string;
  description: string;
  /** Include description in PDF export */
  showDescriptionInPdf: boolean;
  order: number;
  parts: TestPart[];
}

export interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  headerImage: string | null;
  footerText: string;
  timingPoints: TimingPoint[];
  tests: Test[];
  createdAt: string;
  updatedAt: string;
}

export interface ResultRow {
  position: number;
  number: string;
  name: string;
  category: string;
  league: string;
  timeMs: number;
  timeFormatted: string;
  partId?: string;
  partName?: string;
  missingPilot: boolean;
  segmentLabel: string;
}
