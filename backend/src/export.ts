import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import type { Event, ResultRow, Test } from "./types.js";
import { HEADERS_DIR } from "./storage.js";
import { formatMs } from "./timeUtils.js";

interface PenaltyFlags {
  time: boolean;
  position: boolean;
  comment: boolean;
}

function penaltyFlags(rows: ResultRow[]): PenaltyFlags {
  return {
    time: rows.some((r) => (r.timePenaltyMs || 0) > 0),
    position: rows.some((r) => (r.positionPenalty || 0) > 0),
    comment: rows.some((r) => Boolean((r.comment || "").trim())),
  };
}

function esc(v: string): string {
  return `"${(v || "").replace(/"/g, '""')}"`;
}

function penaltyHeaders(flags: PenaltyFlags): string[] {
  const h: string[] = [];
  if (flags.time) h.push("Pen. tiempo");
  if (flags.position) h.push("Pen. pos");
  if (flags.comment) h.push("Comentario");
  return h;
}

function penaltyCells(r: ResultRow, flags: PenaltyFlags): (string | number)[] {
  const cells: (string | number)[] = [];
  if (flags.time) cells.push(r.timePenaltyMs ? formatMs(r.timePenaltyMs) : "");
  if (flags.position) cells.push(r.positionPenalty ? r.positionPenalty : "");
  if (flags.comment) cells.push(r.comment || "");
  return cells;
}

function hasLapResults(rows: ResultRow[]): boolean {
  return rows.some((r) => r.laps != null && r.laps > 0);
}

function lapsCell(r: ResultRow): string {
  if (r.laps == null) return "";
  return r.expectedLaps != null ? `${r.laps}/${r.expectedLaps}` : String(r.laps);
}

function baseHeaders(withLaps: boolean): string[] {
  const h = ["Pos", "N°", "Nombre", "Categoría", "Liga"];
  if (withLaps) h.push("Vueltas");
  h.push("Tiempo", "Salida", "Segmento");
  return h;
}

function baseCells(r: ResultRow, withLaps: boolean): (string | number)[] {
  const cells: (string | number)[] = [
    r.position,
    r.number,
    r.name,
    r.category || "—",
    r.league || "—",
  ];
  if (withLaps) cells.push(lapsCell(r));
  cells.push(r.timeFormatted, r.partName || "—", r.segmentLabel);
  return cells;
}

export function resultsToCsv(rows: ResultRow[], title: string): string {
  const flags = penaltyFlags(rows);
  const withLaps = hasLapResults(rows);
  const header = [...baseHeaders(withLaps), ...penaltyHeaders(flags)];
  const lines = [
    `# ${title}`,
    header.join(","),
    ...rows.map((r) => {
      const base: (string | number)[] = [
        r.position,
        esc(r.number),
        esc(r.name),
        esc(r.category || ""),
        esc(r.league || ""),
      ];
      if (withLaps) base.push(lapsCell(r));
      base.push(r.timeFormatted, esc(r.partName || ""), esc(r.segmentLabel));
      const pens = penaltyCells(r, flags).map((c) => (typeof c === "string" ? esc(c) : c));
      return [...base, ...pens].join(",");
    }),
  ];
  return lines.join("\n");
}

export async function resultsToExcel(
  rows: ResultRow[],
  title: string,
  eventName: string
): Promise<Buffer> {
  const flags = penaltyFlags(rows);
  const withLaps = hasLapResults(rows);
  const penHeaders = penaltyHeaders(flags);
  const wb = new ExcelJS.Workbook();
  wb.creator = "GPMD Cronometraje";
  const ws = wb.addWorksheet("Resultados");

  const headers = [...baseHeaders(withLaps), ...penHeaders];
  const colCount = headers.length;
  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell("A1").value = eventName;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A1A1A" } };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { size: 12, color: { argb: "FF444444" } };

  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D2E" } };
    cell.alignment = { horizontal: "center" };
  });

  for (const r of rows) {
    ws.addRow([...baseCells(r, withLaps), ...penaltyCells(r, flags)]);
  }

  const penWidths = [
    ...(flags.time ? [{ width: 12 }] : []),
    ...(flags.position ? [{ width: 10 }] : []),
    ...(flags.comment ? [{ width: 36 }] : []),
  ];
  ws.columns = [
    { width: 6 },
    { width: 10 },
    { width: 28 },
    { width: 22 },
    { width: 16 },
    ...(withLaps ? [{ width: 10 }] : []),
    { width: 14 },
    { width: 14 },
    { width: 18 },
    ...penWidths,
  ];

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function findHeaderImage(eventId: string): string | null {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp", ".gif"]) {
    const p = path.join(HEADERS_DIR, `${eventId}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

type PdfCol = { label: string; w: number; value: (r: ResultRow) => string };

function buildPdfColumns(flags: PenaltyFlags, pageWidth: number, withLaps: boolean): PdfCol[] {
  const cols: PdfCol[] = [
    { label: "Pos", w: 36, value: (r) => String(r.position) },
    { label: "N°", w: 44, value: (r) => r.number },
    { label: "Nombre", w: 130, value: (r) => r.name || "—" },
    { label: "Categoría", w: 90, value: (r) => r.category || "—" },
    { label: "Liga", w: 68, value: (r) => r.league || "—" },
  ];
  if (withLaps) {
    cols.push({ label: "Vueltas", w: 48, value: (r) => lapsCell(r) || "—" });
  }
  cols.push(
    { label: "Tiempo", w: 64, value: (r) => r.timeFormatted },
    { label: "Salida", w: 72, value: (r) => r.partName || "—" }
  );

  if (flags.time) {
    cols.push({
      label: "Pen. tiempo",
      w: 58,
      value: (r) => (r.timePenaltyMs ? formatMs(r.timePenaltyMs) : "—"),
    });
  }
  if (flags.position) {
    cols.push({
      label: "Pen. pos",
      w: 42,
      value: (r) => (r.positionPenalty ? `+${r.positionPenalty}` : "—"),
    });
  }
  if (flags.comment) {
    cols.push({
      label: "Comentario",
      w: 120,
      value: (r) => r.comment || "",
    });
  }

  const total = cols.reduce((s, c) => s + c.w, 0);
  const scale = pageWidth / total;
  return cols.map((c) => ({ ...c, w: c.w * scale }));
}

/** Draw text without PDFKit auto-creating pages */
function pdfText(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  opts: PDFKit.Mixins.TextOptions = {}
) {
  doc.text(text, x, y, { lineBreak: false, ...opts });
}

export async function resultsToPdf(
  rows: ResultRow[],
  title: string,
  event: Event,
  test?: Test | null
): Promise<Buffer> {
  // Incomplete times (solo A o solo B) stay in the app UI but never in the PDF
  const exportRows = rows.filter((r) => !r.incomplete);
  return new Promise((resolve, reject) => {
    const flags = penaltyFlags(exportRows);
    const hasPenaltyCols = flags.time || flags.position || flags.comment;
    const FOOTER_H = 40;

    const doc = new PDFDocument({
      size: "A4",
      layout: hasPenaltyCols ? "landscape" : "portrait",
      // Bottom margin reserves footer zone so table text never auto-paginates into empty pages
      margins: { top: 36, bottom: FOOTER_H + 8, left: 36, right: 36 },
      bufferPages: true,
      info: { Title: title, Author: "GPMD Cronometraje" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const pageWidth = doc.page.width - left - doc.page.margins.right;
    const contentBottom = () => doc.page.height - doc.page.margins.bottom;
    let y = doc.page.margins.top;

    const headerPath = event.headerImage
      ? path.isAbsolute(event.headerImage)
        ? event.headerImage
        : path.join(HEADERS_DIR, path.basename(event.headerImage))
      : findHeaderImage(event.id);

    if (headerPath && fs.existsSync(headerPath)) {
      try {
        doc.image(headerPath, left, y, {
          fit: [pageWidth, 70],
          align: "center",
        });
        y += 80;
      } catch {
        // ignore
      }
    }

    doc.fillColor("#0B3D2E").fontSize(18).font("Helvetica-Bold");
    pdfText(doc, event.name, left, y, { width: pageWidth, align: "center", lineBreak: true });
    y = doc.y + 4;

    doc.fillColor("#555555").fontSize(11).font("Helvetica");
    pdfText(doc, title, left, y, { width: pageWidth, align: "center", lineBreak: true });
    y = doc.y + 2;

    if (event.date || event.location) {
      doc.fillColor("#777777").fontSize(9);
      pdfText(doc, [event.date, event.location].filter(Boolean).join(" · "), left, y, {
        width: pageWidth,
        align: "center",
        lineBreak: true,
      });
      y = doc.y + 2;
    }

    if (test?.showDescriptionInPdf && test.description?.trim()) {
      y += 6;
      doc.fillColor("#333333").fontSize(9).font("Helvetica");
      pdfText(doc, test.description.trim(), left, y, {
        width: pageWidth,
        align: "center",
        lineBreak: true,
      });
      y = doc.y + 2;
    }

    y += 10;
    doc
      .moveTo(left, y)
      .lineTo(left + pageWidth, y)
      .strokeColor("#0B3D2E")
      .lineWidth(1.5)
      .stroke();
    y += 10;

    const withLaps = hasLapResults(exportRows);
    const cols = buildPdfColumns(flags, pageWidth, withLaps);
    const fontSize = hasPenaltyCols ? 8 : 9;
    const tableHeaderH = 18;

    const drawTableHeader = (yy: number) => {
      doc.rect(left, yy, pageWidth, tableHeaderH).fill("#0B3D2E");
      let x = left + 4;
      doc.fillColor("#FFFFFF").fontSize(fontSize).font("Helvetica-Bold");
      for (const c of cols) {
        pdfText(doc, c.label, x, yy + 5, { width: c.w - 4 });
        x += c.w;
      }
      return yy + tableHeaderH + 2;
    };

    y = drawTableHeader(y);

    const drawFooterOnCurrentPage = (pageLabel: number) => {
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const fy = doc.page.height - 28;
      doc
        .moveTo(left, fy - 8)
        .lineTo(left + pageWidth, fy - 8)
        .strokeColor("#CCCCCC")
        .lineWidth(0.5)
        .stroke();
      doc.fillColor("#888888").fontSize(8).font("Helvetica");
      pdfText(doc, event.footerText || "Gran Premio Mobil Delvac · Cronometraje GPMD", left, fy, {
        width: pageWidth * 0.7,
        align: "left",
      });
      pdfText(doc, `Pág. ${pageLabel}`, left, fy, {
        width: pageWidth,
        align: "right",
      });
      doc.page.margins.bottom = prevBottom;
    };

    doc.font("Helvetica").fontSize(fontSize);
    for (let i = 0; i < exportRows.length; i++) {
      const r = exportRows[i];
      const rowH = flags.comment && r.comment.trim() ? 20 : 15;

      if (y + rowH > contentBottom()) {
        doc.addPage();
        y = doc.page.margins.top;
        y = drawTableHeader(y);
      }

      if (i % 2 === 0) {
        doc.rect(left, y - 1, pageWidth, rowH).fill("#F3F7F5");
      }

      let x = left + 4;
      doc.fillColor("#1A1A1A");
      if (r.position <= 3) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");
      doc.fontSize(fontSize);

      for (const c of cols) {
        pdfText(doc, c.value(r), x, y + 2, { width: c.w - 4 });
        x += c.w;
      }
      y += rowH;
    }

    // Footers only on pages that were actually used
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawFooterOnCurrentPage(i + 1);
    }

    doc.end();
  });
}
