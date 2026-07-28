import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Event, Pilot } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.resolve(__dirname, "../../data");
export const EVENTS_DIR = path.join(DATA_ROOT, "events");
export const HEADERS_DIR = path.join(DATA_ROOT, "uploads", "headers");

/** Default password for events created before passwords existed */
export const DEFAULT_EVENT_PASSWORD = "00000";

function ensureDirs() {
  for (const dir of [EVENTS_DIR, HEADERS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDirs();

function writeJsonAtomic(filePath: string, data: unknown) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/** Strip secrets before sending event data to the client */
export function publicEvent(event: Event): Omit<Event, "password"> & { hasPassword: boolean } {
  const { password: _pw, ...rest } = event;
  return { ...rest, hasPassword: Boolean(event.password) };
}

export function listEvents(): Event[] {
  ensureDirs();
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".json"));
  const events = files.map((f) => {
    const id = f.replace(/\.json$/, "");
    return getEvent(id)!;
  });
  return events.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getEvent(id: string): Event | null {
  const file = path.join(EVENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const event = JSON.parse(fs.readFileSync(file, "utf-8")) as Event;
  event.pilots = event.pilots || [];
  event.fusions = event.fusions || [];
  event.resultsBoard = event.resultsBoard || [];
  if (
    event.boardPageSeconds == null ||
    !Number.isFinite(Number(event.boardPageSeconds))
  ) {
    event.boardPageSeconds = 10;
  } else {
    event.boardPageSeconds = Math.min(
      120,
      Math.max(3, Math.round(Number(event.boardPageSeconds)))
    );
  }
  event.tests = (event.tests || []).map((t) => ({
    ...t,
    description: t.description ?? "",
    showDescriptionInPdf: Boolean(t.showDescriptionInPdf),
    penalties: t.penalties || [],
    parts: (t.parts || []).map((p) => ({
      ...p,
      combinedScoring: p.combinedScoring ?? (p.combinedMode ? "time" : undefined),
      expectedLaps: p.expectedLaps ?? null,
    })),
    fromPointId: t.fromPointId ?? null,
    toPointId: t.toPointId ?? null,
    timingMode: t.timingMode === "start_finish_partial" ? "start_finish_partial" : "point_to_point",
    startFinishPointId: t.startFinishPointId ?? t.fromPointId ?? null,
    partialPointIds: Array.isArray(t.partialPointIds)
      ? t.partialPointIds
      : t.toPointId
        ? [t.toPointId]
        : [],
  }));

  // Migrate events created before passwords existed
  if (!event.password || String(event.password).trim() === "") {
    event.password = DEFAULT_EVENT_PASSWORD;
    writeJsonAtomic(file, event);
  }

  return event;
}

export function saveEvent(event: Event): Event {
  ensureDirs();
  if (!event.pilots) event.pilots = [];
  if (!event.password || String(event.password).trim() === "") {
    event.password = DEFAULT_EVENT_PASSWORD;
  }
  event.updatedAt = new Date().toISOString();
  writeJsonAtomic(path.join(EVENTS_DIR, `${event.id}.json`), event);
  return event;
}

export function deleteEvent(id: string): boolean {
  const file = path.join(EVENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  const header = path.join(HEADERS_DIR, `${id}`);
  for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const p = header + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return true;
}

export function findPilotByNumber(pilots: Pilot[], number: string): Pilot | undefined {
  const normalized = normalizeNumber(number);
  return pilots.find((p) => normalizeNumber(p.number) === normalized);
}

export function normalizeNumber(n: string): string {
  return n.replace(/^#/, "").trim().toUpperCase();
}

export function verifyEventPassword(event: Event, password: string): boolean {
  return String(password) === String(event.password ?? DEFAULT_EVENT_PASSWORD);
}
