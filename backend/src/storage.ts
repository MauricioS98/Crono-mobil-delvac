import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Event, Pilot } from "./types.js";
import {
  loadAllEvents,
  loadEvent,
  persistEvent,
  removeEvent,
} from "./eventsRepo.js";

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

/** Strip secrets before sending event data to the client */
export function publicEvent(event: Event): Omit<Event, "password"> & { hasPassword: boolean } {
  const { password: _pw, ...rest } = event;
  return { ...rest, hasPassword: Boolean(event.password) };
}

function normalizeLoaded(event: Event): Event {
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
  if (!event.password || String(event.password).trim() === "") {
    event.password = DEFAULT_EVENT_PASSWORD;
  }
  return event;
}

export async function listEvents(): Promise<Event[]> {
  const events = await loadAllEvents();
  return events.map(normalizeLoaded);
}

export async function getEvent(id: string): Promise<Event | null> {
  const event = await loadEvent(id);
  if (!event) return null;
  return normalizeLoaded(event);
}

export async function saveEvent(event: Event): Promise<Event> {
  ensureDirs();
  if (!event.pilots) event.pilots = [];
  if (!event.password || String(event.password).trim() === "") {
    event.password = DEFAULT_EVENT_PASSWORD;
  }
  event.updatedAt = new Date().toISOString();
  if (!event.createdAt) event.createdAt = event.updatedAt;
  await persistEvent(event);
  return event;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const ok = await removeEvent(id);
  if (!ok) return false;
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
