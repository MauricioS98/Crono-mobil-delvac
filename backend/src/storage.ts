import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Event, Pilot } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.resolve(__dirname, "../../data");
export const EVENTS_DIR = path.join(DATA_ROOT, "events");
export const PILOTS_FILE = path.join(DATA_ROOT, "pilots", "pilots.json");
export const HEADERS_DIR = path.join(DATA_ROOT, "uploads", "headers");

function ensureDirs() {
  for (const dir of [EVENTS_DIR, path.dirname(PILOTS_FILE), HEADERS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(PILOTS_FILE)) {
    fs.writeFileSync(PILOTS_FILE, "[]", "utf-8");
  }
}

ensureDirs();

function writeJsonAtomic(filePath: string, data: unknown) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

export function listEvents(): Event[] {
  ensureDirs();
  const files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".json"));
  const events = files.map((f) => {
    const raw = fs.readFileSync(path.join(EVENTS_DIR, f), "utf-8");
    return JSON.parse(raw) as Event;
  });
  return events.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getEvent(id: string): Event | null {
  const file = path.join(EVENTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const event = JSON.parse(fs.readFileSync(file, "utf-8")) as Event;
  event.tests = (event.tests || []).map((t) => ({
    ...t,
    description: t.description ?? "",
    showDescriptionInPdf: Boolean(t.showDescriptionInPdf),
  }));
  return event;
}

export function saveEvent(event: Event): Event {
  ensureDirs();
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

export function getPilots(): Pilot[] {
  ensureDirs();
  return JSON.parse(fs.readFileSync(PILOTS_FILE, "utf-8")) as Pilot[];
}

export function savePilots(pilots: Pilot[]): Pilot[] {
  ensureDirs();
  writeJsonAtomic(PILOTS_FILE, pilots);
  return pilots;
}

export function findPilotByNumber(number: string): Pilot | undefined {
  const normalized = normalizeNumber(number);
  return getPilots().find((p) => normalizeNumber(p.number) === normalized);
}

export function normalizeNumber(n: string): string {
  return n.replace(/^#/, "").trim().toUpperCase();
}
