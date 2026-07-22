import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import type { Event, ResultRow, Test } from "./types.js";
import { HEADERS_DIR } from "./storage.js";

export function resultsToCsv(rows: ResultRow[], title: string): string {
  const header = ["Pos", "N°", "Nombre", "Categoría", "Liga", "Tiempo", "Segmento", "Parte"];
  const lines = [
    `# ${title}`,
    header.join(","),
    ...rows.map((r) =>
      [
        r.position,
        `"${r.number}"`,
        `"${r.name.replace(/"/g, '""')}"`,
        `"${(r.category || "").replace(/"/g, '""')}"`,
        `"${(r.league || "").replace(/"/g, '""')}"`,
        r.timeFormatted,
        `"${r.segmentLabel}"`,
        `"${r.partName || ""}"`,
      ].join(",")
    ),
  ];
  return lines.join("\n");
}

export async function resultsToExcel(
  rows: ResultRow[],
  title: string,
  eventName: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GPMD Cronometraje";
  const ws = wb.addWorksheet("Resultados");

  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = eventName;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF1A1A1A" } };

  ws.mergeCells("A2:H2");
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { size: 12, color: { argb: "FF444444" } };

  const headers = ["Pos", "N°", "Nombre", "Categoría", "Liga", "Tiempo", "Segmento", "Parte"];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3D2E" } };
    cell.alignment = { horizontal: "center" };
  });

  for (const r of rows) {
    ws.addRow([
      r.position,
      r.number,
      r.name,
      r.category || "—",
      r.league || "—",
      r.timeFormatted,
      r.segmentLabel,
      r.partName || "—",
    ]);
  }

  ws.columns = [
    { width: 6 },
    { width: 10 },
    { width: 28 },
    { width: 22 },
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
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
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 40, bottom: 50, left: 40, right: 40 },
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
          fit: [pageWidth, 90],
          align: "center",
        });
        y += 100;
      } catch {
        // ignore bad images
      }
    }

    doc
      .fillColor("#0B3D2E")
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(event.name, doc.page.margins.left, y, { width: pageWidth, align: "center" });
    y = doc.y + 6;

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
      y = doc.y + 10;
      doc
        .fillColor("#333333")
        .fontSize(9)
        .font("Helvetica")
        .text(test.description.trim(), doc.page.margins.left, y, {
          width: pageWidth,
          align: "center",
        });
    }

    y = doc.y + 16;
    doc
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + pageWidth, y)
      .strokeColor("#0B3D2E")
      .lineWidth(1.5)
      .stroke();
    y += 12;

    const cols = [
      { label: "Pos", w: 32 },
      { label: "N°", w: 48 },
      { label: "Nombre", w: 140 },
      { label: "Categoría", w: 100 },
      { label: "Liga", w: 70 },
      { label: "Tiempo", w: 70 },
    ];

    const drawHeader = (yy: number) => {
      doc.rect(doc.page.margins.left, yy, pageWidth, 20).fill("#0B3D2E");
      let x = doc.page.margins.left + 4;
      doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold");
      for (const c of cols) {
        doc.text(c.label, x, yy + 6, { width: c.w, continued: false });
        x += c.w;
      }
      return yy + 22;
    };

    y = drawHeader(y);

    const footerHeight = 40;
    let pageNum = 1;
    const drawFooter = () => {
      const fy = doc.page.height - 36;
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

    doc.font("Helvetica").fontSize(9);
    for (let i = 0; i < rows.length; i++) {
      if (y > doc.page.height - footerHeight - 30) {
        drawFooter();
        doc.addPage();
        pageNum += 1;
        y = doc.page.margins.top;
        y = drawHeader(y);
      }

      const r = rows[i];
      if (i % 2 === 0) {
        doc.rect(doc.page.margins.left, y - 2, pageWidth, 16).fill("#F3F7F5");
      }

      const values = [
        String(r.position),
        r.number,
        r.name,
        r.category || "—",
        r.league || "—",
        r.timeFormatted,
      ];
      let x = doc.page.margins.left + 4;
      doc.fillColor("#1A1A1A");
      if (r.position <= 3) doc.font("Helvetica-Bold");
      else doc.font("Helvetica");

      for (let c = 0; c < cols.length; c++) {
        doc.text(values[c], x, y, { width: cols[c].w - 2, lineBreak: false });
        x += cols[c].w;
      }
      y += 16;
    }

    drawFooter();
    doc.end();
  });
}
