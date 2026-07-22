import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  deleteEvent,
  getEvent,
  HEADERS_DIR,
  listEvents,
  saveEvent,
} from "./storage.js";
import type { Event, Pilot, Test, TestPart, TimingPoint } from "./types.js";
import { parseOffsetToMs, formatOffset } from "./timeUtils.js";
import { parseTimingCsv } from "./csvParser.js";
import { computePartResults, computeTestResults, filterNewPilotsVsEarlier, getPart, getTest, resolveTestTimingPoints, upsertPenalty } from "./results.js";
import { computeFusionResults } from "./fusion.js";
import { fusionToCsv, fusionToExcel, fusionToPdf, resultsToCsv, resultsToExcel, resultsToPdf } from "./export.js";
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
    pilots: [],
    tests: [],
    fusions: [],
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
    fromPointId: event.timingPoints[0]?.id ?? null,
    toPointId: event.timingPoints[1]?.id ?? null,
    parts: [],
    penalties: [],
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
  if (req.body.fromPointId !== undefined) {
    test.fromPointId = req.body.fromPointId || null;
  }
  if (req.body.toPointId !== undefined) {
    test.toPointId = req.body.toPointId || null;
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
    combinedScoring: req.body.combinedMode ? req.body.combinedScoring || "time" : undefined,
    expectedLaps:
      req.body.combinedMode && req.body.combinedScoring === "laps"
        ? req.body.expectedLaps === undefined || req.body.expectedLaps === ""
          ? null
          : Number(req.body.expectedLaps)
        : null,
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
  if (req.body.combinedMode != null) {
    part.combinedMode = Boolean(req.body.combinedMode);
    if (!part.combinedMode) {
      part.combinedScoring = undefined;
      part.expectedLaps = null;
    }
  }
  if (req.body.combinedScoring != null) {
    part.combinedScoring = req.body.combinedScoring === "laps" ? "laps" : "time";
    if (part.combinedScoring !== "laps") part.expectedLaps = null;
  }
  if (req.body.expectedLaps !== undefined) {
    const raw = req.body.expectedLaps;
    part.expectedLaps =
      raw === null || raw === "" || raw === "indeterminate" ? null : Number(raw);
  }
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
  const { fromId, toId } = resolveTestTimingPoints(event, test, fromPointId, toPointId);

  let rows;
  let warning: string | undefined;
  let scope: string;
  let title: string;
  let diffNote: string | undefined;
  if (partId) {
    const part = getPart(test, partId);
    if (!part) return res.status(404).json({ error: "Parte no encontrada" });
    ({ rows, warning, scope } = computePartResults(event, test, part, fromId, toId));
    const diff = filterNewPilotsVsEarlier(event, test, part, rows, fromId, toId);
    rows = diff.rows;
    diffNote = diff.diffNote;
    title = `${test.name} — ${part.name}`;
  } else {
    ({ rows, warning, scope } = computeTestResults(event, test, fromId, toId));
    title = `${test.name} — Resultado unificado`;
  }

  res.json({
    title,
    rows,
    warning: warning || null,
    diffNote: diffNote || null,
    scope,
    eventName: event.name,
  });
});

router.get("/events/:id/fusion", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const raw = req.query.tests;
  const testIds = Array.isArray(raw)
    ? raw.flatMap((v) => String(v).split(","))
    : String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  const result = computeFusionResults(event, testIds);
  res.json({
    ...result,
    warning: result.warning || null,
    eventName: event.name,
  });
});

function parseFusionTestIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean);
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function sendFusionExport(
  res: import("express").Response,
  event: Event,
  fusionName: string,
  tests: { id: string; name: string; segmentLabel: string }[],
  rows: import("./types.js").FusionRow[],
  format: string
) {
  const title = fusionName;
  const safeName = title.replace(/[^\w\-]+/g, "_");

  if (format === "csv") {
    const csv = fusionToCsv(rows, tests, title);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.csv"`);
    return res.send("\uFEFF" + csv);
  }
  if (format === "xlsx" || format === "excel") {
    const buf = await fusionToExcel(rows, tests, title, event.name);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.xlsx"`);
    return res.send(buf);
  }
  if (format === "pdf") {
    const buf = await fusionToPdf(rows, tests, title, event);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    return res.send(buf);
  }
  return res.status(400).json({ error: "Formato no soportado (csv|xlsx|pdf)" });
}

router.get("/events/:id/fusion/export/:format", async (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const testIds = parseFusionTestIds(req.query.tests);
  const result = computeFusionResults(event, testIds);
  if (result.rows.length === 0) {
    return res.status(400).json({ error: result.warning || "Sin resultados para exportar" });
  }

  const name = String(req.query.name || result.title).trim() || result.title;

  try {
    return await sendFusionExport(res, event, name, result.tests, result.rows, req.params.format);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al exportar" });
  }
});

router.post("/events/:id/fusions", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Indica un nombre para la fusión" });

  const testIds = parseFusionTestIds(req.body.testIds);
  const result = computeFusionResults(event, testIds);
  if (result.rows.length === 0) {
    return res.status(400).json({ error: result.warning || "Sin resultados para guardar" });
  }

  if (!event.fusions) event.fusions = [];
  const saved = {
    id: uuid(),
    name,
    testIds: result.tests.map((t) => t.id),
    tests: result.tests,
    rows: result.rows,
    warning: result.warning || null,
    createdAt: new Date().toISOString(),
  };
  event.fusions.push(saved);
  saveEvent(event);
  res.status(201).json(saved);
});

router.delete("/events/:id/fusions/:fusionId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const before = event.fusions?.length || 0;
  event.fusions = (event.fusions || []).filter((f) => f.id !== req.params.fusionId);
  if (event.fusions.length === before) {
    return res.status(404).json({ error: "Fusión no encontrada" });
  }
  saveEvent(event);
  res.json({ ok: true });
});

router.get("/events/:id/fusions/:fusionId/export/:format", async (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });

  const fusion = (event.fusions || []).find((f) => f.id === req.params.fusionId);
  if (!fusion) return res.status(404).json({ error: "Fusión no encontrada" });

  try {
    return await sendFusionExport(res, event, fusion.name, fusion.tests, fusion.rows, req.params.format);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error al exportar" });
  }
});

router.put("/events/:id/tests/:testId/penalties", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });

  try {
    let timePenaltyMs = Number(req.body.timePenaltyMs);
    if (Number.isNaN(timePenaltyMs)) {
      timePenaltyMs = parseOffsetToMs(String(req.body.timePenalty || "0"));
    }
    upsertPenalty(test, {
      number: String(req.body.number || ""),
      scope: String(req.body.scope || "unified"),
      timePenaltyMs,
      positionPenalty: Number(req.body.positionPenalty || 0),
      comment: String(req.body.comment || ""),
    });
    if (!test.penalties) test.penalties = [];
    saveEvent(event);
    res.json({ ok: true, penalties: test.penalties });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Error al guardar penalización" });
  }
});

router.get("/events/:id/tests/:testId/export/:format", async (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const test = getTest(event, req.params.testId);
  if (!test) return res.status(404).json({ error: "Prueba no encontrada" });

  const fromPointId = req.query.from as string | undefined;
  const toPointId = req.query.to as string | undefined;
  const partId = req.query.partId as string | undefined;
  const { fromId, toId } = resolveTestTimingPoints(event, test, fromPointId, toPointId);

  let rows;
  let title: string;
  if (partId) {
    const part = getPart(test, partId);
    if (!part) return res.status(404).json({ error: "Parte no encontrada" });
    ({ rows } = computePartResults(event, test, part, fromId, toId));
    rows = filterNewPilotsVsEarlier(event, test, part, rows, fromId, toId).rows;
    title = `${test.name} — ${part.name}`;
  } else {
    ({ rows } = computeTestResults(event, test, fromId, toId));
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

// ─── Event pilots ─────────────────────────────────────────
router.get("/events/:id/pilots", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  res.json(event.pilots);
});

router.post("/events/:id/pilots/import/preview", upload.single("file"), (req, res) => {
  if (!getEvent(req.params.id)) return res.status(404).json({ error: "Evento no encontrado" });
  if (!req.file) return res.status(400).json({ error: "Archivo CSV requerido" });
  try {
    const content = req.file.buffer.toString("utf-8");
    res.json(previewPilotsCsv(content, req.file.originalname));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Error al leer CSV" });
  }
});

router.post("/events/:id/pilots/import", upload.single("file"), (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
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
    const result = importPilotsFromCsv(content, event.pilots || [], mapping, { skipFirstRow });
    event.pilots = result.pilots;
    saveEvent(event);
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

router.post("/events/:id/pilots", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const pilot: Pilot = {
    id: uuid(),
    number: req.body.number || "",
    name: req.body.name || "",
    category: req.body.category || "",
    league: req.body.league || "",
    notes: req.body.notes || "",
  };
  event.pilots = event.pilots || [];
  event.pilots.push(pilot);
  saveEvent(event);
  res.status(201).json(pilot);
});

router.put("/events/:id/pilots/:pilotId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  const idx = (event.pilots || []).findIndex((p) => p.id === req.params.pilotId);
  if (idx < 0) return res.status(404).json({ error: "Piloto no encontrado" });
  event.pilots[idx] = { ...event.pilots[idx], ...req.body, id: event.pilots[idx].id };
  saveEvent(event);
  res.json(event.pilots[idx]);
});

router.delete("/events/:id/pilots/:pilotId", (req, res) => {
  const event = getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: "Evento no encontrado" });
  event.pilots = (event.pilots || []).filter((p) => p.id !== req.params.pilotId);
  saveEvent(event);
  res.json({ ok: true });
});

export default router;
