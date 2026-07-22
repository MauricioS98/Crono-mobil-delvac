import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import type { Event, ResultRow, Test } from "./types.js";
import { HEADERS_DIR } from "./storage.js";
import { formatMs } from "./timeUtils.js";

function hasAnyPenalty(rows: ResultRow[]): boolean {
  return rows.some((r) => r.hasPenalty);
}

function esc(v: string): string {
  return `"${(v || "").replace(/"/g, '""')}"`;
}

export function resultsToCsv(rows: ResultRow[], title: string): string {
  const withPen = hasAnyPenalty(rows);
  const header = [
    "Pos",
    "N°",
    "Nombre",
    "Categoría",
    "Liga",
    "Tiempo",
    "Salida",
    "Segmento",
    ...(withPen ? ["Pen. tiempo", "Pen. pos", "Comentario"] : []),
  ];
  const lines = [
    `# ${title}`,
    header.join(","),
    ...rows.map((r) => {
      const base = [
        r.position,
        esc(r.number),
        esc(r.name),
        esc(r.category || ""),
        esc(r.league || ""),
        r.timeFormatted,
        esc(r.partName || ""),
        esc(r.segmentLabel),
      ];
      if (withPen) {
        base.push(
          r.timePenaltyMs ? formatMs(r.timePenaltyMs) : "",
          r.positionPenalty ? String(r.positionPenalty) : "",
          esc(r.comment || "")
        );
      }
      return base.join(",");
    }),
  ];
  return lines.join("\n");
}

export async function resultsToExcel(
  rows: ResultRow[],
  title: string,
  eventName: string
): Promise<Buffer> {
  const withPen = hasAnyPenalty(rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = "GPMD Cronometraje";
  const ws = wb.addWorksheet("Resultados");

  const colCount = withPen ? 11 : 8;
  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell("A1").value = eventName;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A1A1A" } };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { size: 12, color: { argb: "FF444444" } };

  const headers = [
    "Pos",
    "N°",
    "Nombre",
    "Categoría",
    "Liga",
    "Tiempo",
    "Salida",
    "Segmento",
    ...(withPen ? ["Pen. tiempo", "Pen. pos", "Comentario"] : []),
  ];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D2E" } };
    cell.alignment = { horizontal: "center" };
  });

  for (const r of rows) {
    const vals: (string | number)[] = [
      r.position,
      r.number,
      r.name,
      r.category || "—",
      r.league || "—",
      r.timeFormatted,
      r.partName || "—",
      r.segmentLabel,
    ];
    if (withPen) {
      vals.push(
        r.timePenaltyMs ? formatMs(r.timePenaltyMs) : "",
        r.positionPenalty || "",
        r.comment || ""
      );
    }
    ws.addRow(vals);
  }

  ws.columns = [
    { width: 6 },
    { width: 10 },
    { width: 28 },
    { width: 22 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    ...(withPen ? [{ width: 12 }, { width: 10 }, { width: 36 }] : []),
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

export async function resultsToPdf(
  rows: ResultRow[],
  title: string,
  event: Event,
  test?: Test | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const withPen = hasAnyPenalty(rows);
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 36, bottom: 44, left: 36, right: 36 },
      info: { Title: title, Author: "GPMD Cronometraje" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let y = doc.page.margins.top;

    const headerPath = event.headerImage
      ? path.isAbsolute(event.headerImage)
        ? event.headerImage
        : path.join(HEADERS_DIR, path.basename(event.headerImage))
      : findHeaderImage(event.id);

    if (headerPath && fs.existsSync(headerPath)) {
      try {
        doc.image(headerPath, doc.page.margins.left, y, {
          fit: [pageWidth, 70],
          align: "center",
        });
        y += 80;
      } catch {
        // ignore
      }
    }

    doc
      .fillColor("#0B3D2E")
      .fontSize(18)
      .font("Helvetica-Bold")
      .text(event.name, doc.page.margins.left, y, { width: pageWidth, align: "center" });
    y = doc.y + 4;

    doc
      .fillColor("#555555")
      .fontSize(11)
      .font("Helvetica")
      .text(title, { width: pageWidth, align: "center" });

    if (event.date || event.location) {
      doc
        .fillColor("#777777")
        .fontSize(9)
        .text([event.date, event.location].filter(Boolean).join(" · "), {
          width: pageWidth,
          align: "center",
        });
    }

    if (test?.showDescriptionInPdf && test.description?.trim()) {
      y = doc.y + 8;
      doc
        .fillColor("#333333")
        .fontSize(9)
        .font("Helvetica")
        .text(test.description.trim(), doc.page.margins.left, y, {
          width: pageWidth,
          align: "center",
        });
    }

    y = doc.y + 12;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + pageWidth, y)
      .strokeColor("#0B3D2E")
      .lineWidth(1.5)
      .stroke();
    y += 10;

    const cols = withPen
      ? [
          { label: "Pos", w: 32 },
          { label: "N°", w: 42 },
          { label: "Nombre", w: 130 },
          { label: "Categoría", w: 90 },
          { label: "Liga", w: 70 },
          { label: "Tiempo", w: 62 },
          { label: "Salida", w: 70 },
          { label: "Pen.t", w: 50 },
          { label: "Pen.p", w: 36 },
          { label: "Comentario", w: 130 },
        ]
      : [
          { label: "Pos", w: 36 },
          { label: "N°", w: 48 },
          { label: "Nombre", w: 160 },
          { label: "Categoría", w: 110 },
          { label: "Liga", w: 80 },
          { label: "Tiempo", w: 70 },
          { label: "Salida", w: 90 },
        ];

    const drawHeader = (yy: number) => {
      doc.rect(doc.page.margins.left, yy, pageWidth, 18).fill("#0B3D2E");
      let x = doc.page.margins.left + 4;
      doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
      for (const c of cols) {
        doc.text(c.label, x, yy + 5, { width: c.w, continued: false });
        x += c.w;
      }
      return yy + 20;
    };

    y = drawHeader(y);

    const footerHeight = 36;
    let pageNum = 1;
    const drawFooter = () => {
      const fy = doc.page.height - 32;
      doc
        .moveTo(doc.page.margins.left, fy - 8)
        .lineTo(doc.page.margins.left + pageWidth, fy - 8)
        .strokeColor("#CCCCCC")
        .lineWidth(0.5)
        .stroke();
      doc
        .fillColor("#888888")
        .fontSize(8)
        .font("Helvetica")
        .text(
          event.footerText || "Gran Premio Mobil Delvac · Cronometraje GPMD",
          doc.page.margins.left,
          fy,
          { width: pageWidth * 0.7, align: "left" }
        );
      doc.text(`Pág. ${pageNum}`, doc.page.margins.left, fy, {
        width: pageWidth,
        align: "right",
      });
    };

    doc.font("Helvetica").fontSize(8);
    for (let i = 0; i < rows.length; i++) {
      const rowH = withPen && rows[i].comment ? 22 : 15;
      if (y > doc.page.height - footerHeight - rowH - 8) {
        drawFooter();
        doc.addPage();
        pageNum += 1;
        y = doc.page.margins.top;
        y = drawHeader(y);
      }

      const r = rows[i];
      if (i % 2 === 0) {
        doc.rect(doc.page.margins.left, y - 2, pageWidth, rowH).fill("#F3F7F5");
      }

      const values = withPen
        ? [
            String(r.position),
            r.number,
            r.name || "—",
            r.category || "—",
            r.league || "—",
            r.timeFormatted,
            r.partName || "—",
            r.timePenaltyMs ? formatMs(r.timePenaltyMs) : "—",
            r.positionPenalty ? `+${r.positionPenalty}` : "—",
            r.comment || "",
          ]
        : [
            String(r.position),
            r.number,
            r.name || "—",
            r.category || "—",
            r.league || "—",
            r.timeFormatted,
            r.partName || "—",
          ];

      let x = doc.page.margins.left + 4;
      doc.fillColor("#1A1A1A");
      if (r.position <= 3) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");

      for (let c = 0; c < cols.length; c++) {
        doc.text(values[c], x, y, { width: cols[c].w - 2, lineBreak: false, height: rowH });
        x += cols[c].w;
      }
      y += rowH;
    }

    drawFooter();
    doc.end();
  });
}
