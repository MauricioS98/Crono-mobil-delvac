export interface TimingPoint {
  id: string;
  name: string;
  offsetMs: number;
  order: number;
  offsetFormatted?: string;
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
  lapsCount?: number | null;
  elapsedMs?: number | null;
  clase: string;
}

export type CombinedScoring = "time" | "laps";

export interface FlagEvent {
  type: string;
  tmPasosMs: number;
  tmPasosRaw: string;
  label: string;
}

export interface ParsedCsv {
  filename: string;
  passages: Passage[];
  flags: FlagEvent[];
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
  combinedMode: boolean;
  combinedScoring?: CombinedScoring;
  expectedLaps?: number | null;
  csvs: PartCsvSlot[];
}

export interface PilotPenalty {
  number: string;
  /** Kept for compatibility; penalties are shared per pilot in the test */
  scope: string;
  timePenaltyMs: number;
  positionPenalty: number;
  comment: string;
}

export interface Test {
  id: string;
  name: string;
  description: string;
  showDescriptionInPdf: boolean;
  order: number;
  parts: TestPart[];
  penalties: PilotPenalty[];
}

export interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  headerImage: string | null;
  footerText: string;
  timingPoints: TimingPoint[];
  pilots: Pilot[];
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
  rawTimeMs: number;
  rawTimeFormatted: string;
  timeMs: number;
  timeFormatted: string;
  timePenaltyMs: number;
  positionPenalty: number;
  comment: string;
  hasPenalty: boolean;
  partId?: string;
  partName?: string;
  missingPilot: boolean;
  segmentLabel: string;
  incomplete?: boolean;
  incompleteReason?: "missing_start" | "missing_finish";
  statusLabel?: string;
  laps?: number;
  expectedLaps?: number | null;
  lapsIncomplete?: boolean;
}
