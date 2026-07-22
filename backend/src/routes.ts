import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  deleteEvent,
  getEvent,
  getPilots,
  HEADERS_DIR,
  listEvents,
  saveEvent,
  savePilots,
} from "./storage.js";
import type { Event, Pilot, Test, TestPart, TimingPoint } from "./types.js";
import { parseOffsetToMs, formatOffset } from "./timeUtils.js";
import { parseTimingCsv } from "./csvParser.js";
import { computePartResults, computeTestResults, getPart, getTest } from "./results.js";
import { resultsToCsv, resultsToExcel, resultsToPdf } from "./export.js";
import { importPilotsFromCsv, previewPilotsCsv, type ColumnMapping } from "./pilotsCsv.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

function emptyEvent(body: Partial<Event>): Event {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name: body.name || "Nuevo evento",
    date: body.date || "",
    location: body.location || "",
    headerImage: null,
    footerText: body.footerText || "Gran Premio Mobil Delvac",
    timingPoints: [
      { id: uuid(), name: "PC A", offsetMs: 0, order: 0 },
      { id: uuid(), name: "PC B", offsetMs: 0, order: 1 },
    ],
    tests: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Events ───────────────────────────────────────────────
router.get("/events", (_req, res) => {
  res.json(listEvents());
});

router.get("/events/:id", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  res.json(event);
});

router.post("/events", (req, res) => {
  const event = emptyEvent(req.body || {});
  saveEvent(event);
  res.status(201).json(event);
});

router.put("/events/:id", (req, res) => {
  const existing = getEvent(req.params.id);
  if (!existing) return res.status(404).json({ error: "Evento no encontrado" });
  const updated: Event = {
    ...existing,
    name: req.body.name ?? existing.name,
    date: req.body.date ?? existing.date,
    location: req.body.location ?? existing.location,
    footerText: req.body.footerText ?? existing.footerText,
  };
  saveEvent(updated);
  res.json(updated);
});

router.delete("/events/:id", (req, res) => {
  if (!deleteEvent(req.params.id)) return res.status(404).json({ error: "Evento no encontrado" });
  res.json({ ok: true });
});

router.post("/events/:id/header", upload.single("image"), (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  if (!req.file) return res.status(400).json({ error: "Imagen requerida" });

  const ext = path.extname(req.file.originalname).toLowerCase() || ".png";
  const filename = `${event.id}${ext}`;
  const dest = path.join(HEADERS_DIR, filename);
  fs.writeFileSync(dest, req.file.buffer);
  event.headerImage = filename;
  saveEvent(event);
  res.json(event);
});

// ─── Timing points ────────────────────────────────────────
router.put("/events/:id/timing-points", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const points: TimingPoint[] = (req.body.timingPoints || []).map(
    (p: Partial<TimingPoint> & { offset?: string }, i: number) => ({
      id: p.id || uuid(),
      name: p.name || `PC ${String.fromCharCode(65 + i)}`,
      offsetMs:
        typeof p.offsetMs === "number"
          ? p.offsetMs
          : parseOffsetToMs(p.offset || "0"),
      order: typeof p.order === "number" ? p.order : i,
    })
  );

  // First point is always reference (offset 0)
  if (points.length > 0) {
    points.sort((a, b) => a.order - b.order);
    points[0].offsetMs = 0;
  }

  event.timingPoints = points;
  saveEvent(event);
  res.json({
    ...event,
    timingPoints: event.timingPoints.map((p) => ({
      ...p,
      offsetFormatted: formatOffset(p.offsetMs),
    })),
  });
});

// ─── Tests & parts ────────────────────────────────────────
router.post("/events/:id/tests", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const test: Test = {
    id: uuid(),
    name: req.body.name || `Prueba ${event.tests.length + 1}`,
    description: req.body.description || "",
    showDescriptionInPdf: Boolean(req.body.showDescriptionInPdf),
    order: event.tests.length,
    parts: [],
  };
  event.tests.push(test);
  saveEvent(event);
  res.status(201).json(test);
});

router.put("/events/:id/tests/:testId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });
  if (req.body.name != null) test.name = req.body.name;
  if (req.body.description != null) test.description = String(req.body.description);
  if (req.body.showDescriptionInPdf != null) {
    test.showDescriptionInPdf = Boolean(req.body.showDescriptionInPdf);
  }
  // Backfill for older events
  if (test.description == null) test.description = "";
  if (test.showDescriptionInPdf == null) test.showDescriptionInPdf = false;
  saveEvent(event);
  res.json(test);
});

router.delete("/events/:id/tests/:testId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  event.tests = event.tests.filter((t) => t.id !== req.params.testId);
  saveEvent(event);
  res.json({ ok: true });
});

router.post("/events/:id/tests/:testId/parts", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });

  const part: TestPart = {
    id: uuid(),
    name: req.body.name || `Salida ${test.parts.length + 1}`,
    order: test.parts.length,
    combinedMode: Boolean(req.body.combinedMode),
    csvs: [],
  };
  test.parts.push(part);
  saveEvent(event);
  res.status(201).json(part);
});

router.put("/events/:id/tests/:testId/parts/:partId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });
  const part = getPart(test, req.params.partId);
  if (!part) return res.status(404).json({ error: "Parte no encontrada" });

  if (req.body.name != null) part.name = req.body.name;
  if (req.body.combinedMode != null) part.combinedMode = Boolean(req.body.combinedMode);
  saveEvent(event);
  res.json(part);
});

router.delete("/events/:id/tests/:testId/parts/:partId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });
  test.parts = test.parts.filter((p) => p.id !== req.params.partId);
  saveEvent(event);
  res.json({ ok: true });
});

// ─── CSV upload ───────────────────────────────────────────
router.post(
  "/events/:id/tests/:testId/parts/:partId/csv",
  upload.single("file"),
  (req, res) => {
    const event = getEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "Evento no encontrado" });
    const test = getTest(event, req.params.testId);
    if (!test) return res.status(404).json({ error: "Prueba no encontrada" });
    const part = getPart(test, req.params.partId);
    if (!part) return res.status(404).json({ error: "Parte no encontrada" });
    if (!req.file) return res.status(400).json({ error: "Archivo CSV requerido" });

    const timingPointId = String(req.body.timingPointId || "");
    if (!timingPointId && !part.combinedMode) {
      return res.status(400).json({ error: "timingPointId requerido" });
    }

    const content = req.file.buffer.toString("utf-8");
    const parsed = parseTimingCsv(content, req.file.originalname);

    const slotId = part.combinedMode
      ? event.timingPoints[0]?.id || timingPointId || "combined"
      : timingPointId;

    const existing = part.csvs.findIndex((c) => c.timingPointId === slotId);
    const slot = {
      timingPointId: slotId,
      filename: req.file.originalname,
      parsed,
    };
    if (existing >= 0) part.csvs[existing] = slot;
    else part.csvs.push(slot);

    // Auto-detect combined mode if lap times present and only one file
    if (part.csvs.length === 1) {
      const hasLaps = parsed.racePassages.some((p) => p.lapTimeMs != null && p.lapTimeMs > 0);
      if (hasLaps && req.body.combinedMode === "true") {
        part.combinedMode = true;
      }
    }

    saveEvent(event);
    res.json({
      part,
      summary: {
        filename: parsed.filename,
        pilots: parsed.racePassages.length,
        uniquePilots: new Set(parsed.racePassages.map((p) => p.number)).size,
        flags: parsed.flags.map((f) => ({ type: f.type, label: f.label, time: f.tmPasosRaw })),
      },
    });
  }
);

// ─── Results ──────────────────────────────────────────────
router.get("/events/:id/tests/:testId/results", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });

  const fromPointId = req.query.from as string | undefined;
  const toPointId = req.query.to as string | undefined;
  const partId = req.query.partId as string | undefined;

  let rows;
  let warning: string | undefined;
  let title: string;
  if (partId) {
    const part = getPart(test, partId);
    if (!part) return res.status(404).json({ error: "Parte no encontrada" });
    ({ rows, warning } = computePartResults(event, part, fromPointId, toPointId));
    title = `${test.name} — ${part.name}`;
  } else {
    ({ rows, warning } = computeTestResults(event, test, fromPointId, toPointId));
    title = `${test.name} — Resultado unificado`;
  }

  res.json({ title, rows, warning: warning || null, eventName: event.name });
});

router.get("/events/:id/tests/:testId/export/:format", async (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });

  const fromPointId = req.query.from as string | undefined;
  const toPointId = req.query.to as string | undefined;
  const partId = req.query.partId as string | undefined;

  let rows;
  let title: string;
  if (partId) {
    const part = getPart(test, partId);
    if (!part) return res.status(404).json({ error: "Parte no encontrada" });
    ({ rows } = computePartResults(event, part, fromPointId, toPointId));
    title = `${test.name} — ${part.name}`;
  } else {
    ({ rows } = computeTestResults(event, test, fromPointId, toPointId));
    title = `${test.name} — Resultado unificado`;
  }

  const format = req.params.format;
  const safeName = title.replace(/[^\w\-]+/g, "_");

  try {
    if (format === "csv") {
      const csv = resultsToCsv(rows, title);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
      return res.send("\uFEFF" + csv);
    }
    if (format === "xlsx" || format === "excel") {
      const buf = await resultsToExcel(rows, title, event.name);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
      return res.send(buf);
    }
    if (format === "pdf") {
      const buf = await resultsToPdf(rows, title, event, test);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      return res.send(buf);
    }
    return res.status(400).json({ error: "Formato no soportado (csv|xlsx|pdf)" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al exportar" });
  }
});

// ─── Pilots ───────────────────────────────────────────────
router.get("/pilots", (_req, res) => {
  res.json(getPilots());
});

router.post("/pilots/import/preview", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Archivo CSV requerido" });
  try {
    const content = req.file.buffer.toString("utf-8");
    const preview = previewPilotsCsv(content, req.file.originalname);
    res.json(preview);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Error al leer CSV" });
  }
});

router.post("/pilots/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Archivo CSV requerido" });
  try {
    const content = req.file.buffer.toString("utf-8");
    let mapping: ColumnMapping = {};
    if (req.body.mapping) {
      mapping = typeof req.body.mapping === "string" ? JSON.parse(req.body.mapping) : req.body.mapping;
    } else {
      mapping = previewPilotsCsv(content).suggestedMapping;
    }
    const skipFirstRow = req.body.skipFirstRow !== "false" && req.body.skipFirstRow !== false;
    const result = importPilotsFromCsv(content, getPilots(), mapping, { skipFirstRow });
    savePilots(result.pilots);
    res.json({
      pilots: result.pilots,
      summary: {
        total: result.pilots.length,
        added: result.added,
        updated: result.updated,
        skipped: result.skipped,
        filename: req.file.originalname,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Error al importar CSV" });
  }
});

router.put("/pilots", (req, res) => {
  const pilots = (req.body as Pilot[]).map((p) => ({
    id: p.id || uuid(),
    number: p.number,
    name: p.name,
    category: p.category || "",
    league: p.league || "",
    notes: p.notes || "",
  }));
  savePilots(pilots);
  res.json(pilots);
});

router.post("/pilots", (req, res) => {
  const pilots = getPilots();
  const pilot: Pilot = {
    id: uuid(),
    number: req.body.number || "",
    name: req.body.name || "",
    category: req.body.category || "",
    league: req.body.league || "",
    notes: req.body.notes || "",
  };
  pilots.push(pilot);
  savePilots(pilots);
  res.status(201).json(pilot);
});

router.put("/pilots/:id", (req, res) => {
  const pilots = getPilots();
  const idx = pilots.findIndex((p) => p.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Piloto no encontrado" });
  pilots[idx] = { ...pilots[idx], ...req.body, id: pilots[idx].id };
  savePilots(pilots);
  res.json(pilots[idx]);
});

router.delete("/pilots/:id", (req, res) => {
  const pilots = getPilots().filter((p) => p.id !== req.params.id);
  savePilots(pilots);
  res.json({ ok: true });
});

export default router;
