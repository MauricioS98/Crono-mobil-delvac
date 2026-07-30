import { randomUUID } from "crypto";
import type pg from "pg";
import { pool, withTransaction } from "./db.js";
import type { Event, PartCsvSlot, Passage } from "./types.js";

type Q = pg.PoolClient;

async function q(client: Q, text: string, params?: unknown[]) {
  return client.query(text, params);
}

function uuidList(ids: string[]): string[] {
  return ids;
}

/** Batch-insert passages (much faster on Render / remote PG). */
async function insertPassagesBatch(
  client: Q,
  uploadId: string,
  passages: Passage[],
  racePassages: Passage[]
) {
  if (!passages.length) return;
  const raceKeys = new Set(
    (racePassages || []).map((r) => `${r.rowIndex}|${r.number}|${r.tmPasosMs}`)
  );

  const chunkSize = 100;
  for (let i = 0; i < passages.length; i += chunkSize) {
    const chunk = passages.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    let p = 1;
    for (const pass of chunk) {
      const key = `${pass.rowIndex}|${pass.number}|${pass.tmPasosMs}`;
      const isRace =
        raceKeys.has(key) ||
        (racePassages || []).some(
          (r) =>
            r.rowIndex === pass.rowIndex && String(r.number) === String(pass.number)
        );
      rowsSql.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
      );
      values.push(
        uploadId,
        pass.number || "",
        pass.name || "",
        pass.tmPasosMs || 0,
        pass.tmPasosRaw || "",
        pass.lapTimeMs,
        pass.lapTimeRaw || "",
        pass.lapsCount,
        pass.elapsedMs,
        pass.clase || "",
        pass.rowIndex || 0,
        isRace
      );
    }
    await q(
      client,
      `INSERT INTO csv_passages (
        csv_upload_id, number, name, tm_pasos_ms, tm_pasos_raw,
        lap_time_ms, lap_time_raw, laps_count, elapsed_ms, clase, row_index, is_race
      ) VALUES ${rowsSql.join(",")}`,
      values
    );
  }
}

/**
 * Replace CSV slots for one part only (used on upload).
 * Does not rewrite the rest of the event.
 */
export async function replacePartCsvs(partId: string, csvs: PartCsvSlot[]): Promise<void> {
  await withTransaction(async (client) => {
    await q(client, `DELETE FROM csv_uploads WHERE part_id = $1`, [partId]);

    for (const slot of csvs || []) {
      const uploadId = randomUUID();
      await q(
        client,
        `INSERT INTO csv_uploads (id, part_id, timing_point_id, filename, uploaded_at)
         VALUES ($1,$2,$3,$4, now())`,
        [uploadId, partId, slot.timingPointId, slot.filename]
      );
      const parsed = slot.parsed || {
        filename: slot.filename,
        passages: [],
        racePassages: [],
        flags: [],
      };
      await insertPassagesBatch(
        client,
        uploadId,
        parsed.passages || [],
        parsed.racePassages || []
      );
      for (const fl of parsed.flags || []) {
        await q(
          client,
          `INSERT INTO csv_flags (
            csv_upload_id, flag_type, tm_pasos_ms, tm_pasos_raw, label, row_index
          ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            uploadId,
            fl.type || "other",
            fl.tmPasosMs || 0,
            fl.tmPasosRaw || "",
            fl.label || "",
            fl.rowIndex || 0,
          ]
        );
      }
    }
  });
}

/**
 * Upsert event structure WITHOUT rewriting CSV passages.
 * This is the hot path (penalties, meta, pilots, board, etc.).
 */
export async function persistEvent(event: Event): Promise<Event> {
  event.updatedAt = new Date().toISOString();
  if (!event.createdAt) event.createdAt = event.updatedAt;
  const theme = event.themeColors?.length ? event.themeColors : null;

  await withTransaction(async (client) => {
    await q(
      client,
      `INSERT INTO events (
        id, name, event_date, location, header_image, footer_text, password,
        theme_colors, board_page_seconds, overlay_variant, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        event_date = EXCLUDED.event_date,
        location = EXCLUDED.location,
        header_image = EXCLUDED.header_image,
        footer_text = EXCLUDED.footer_text,
        password = EXCLUDED.password,
        theme_colors = EXCLUDED.theme_colors,
        board_page_seconds = EXCLUDED.board_page_seconds,
        overlay_variant = EXCLUDED.overlay_variant,
        updated_at = EXCLUDED.updated_at`,
      [
        event.id,
        event.name,
        event.date || "",
        event.location || "",
        event.headerImage,
        event.footerText || "Minerva Timing",
        event.password,
        theme,
        Math.min(120, Math.max(3, Math.round(event.boardPageSeconds ?? 10))),
        event.overlayVariant === "redbull" ? "redbull" : "classic",
        event.createdAt,
        event.updatedAt,
      ]
    );

    // Avoid UNIQUE(event_id, sort_order) clashes while reordering
    await q(
      client,
      `UPDATE timing_points SET sort_order = sort_order - 100000 WHERE event_id = $1 AND sort_order >= 0`,
      [event.id]
    );

    for (const p of event.timingPoints || []) {
      await q(
        client,
        `INSERT INTO timing_points (id, event_id, name, offset_ms, sort_order, role)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           offset_ms = EXCLUDED.offset_ms,
           sort_order = EXCLUDED.sort_order,
           role = EXCLUDED.role`,
        [p.id, event.id, p.name, p.offsetMs || 0, p.order, p.role ?? null]
      );
    }
    const pointIds = uuidList((event.timingPoints || []).map((p) => p.id));
    await q(
      client,
      `DELETE FROM timing_points WHERE event_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [event.id, pointIds]
    );

    for (const p of event.pilots || []) {
      await q(
        client,
        `INSERT INTO pilots (id, event_id, number, name, category, league, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           number = EXCLUDED.number,
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           league = EXCLUDED.league,
           notes = EXCLUDED.notes`,
        [
          p.id,
          event.id,
          p.number,
          p.name || "",
          p.category || "",
          p.league || "",
          p.notes || "",
        ]
      );
    }
    await q(
      client,
      `DELETE FROM pilots WHERE event_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [event.id, uuidList((event.pilots || []).map((p) => p.id))]
    );

    await q(
      client,
      `UPDATE tests SET sort_order = sort_order - 100000 WHERE event_id = $1 AND sort_order >= 0`,
      [event.id]
    );

    for (const t of event.tests || []) {
      await q(
        client,
        `INSERT INTO tests (
          id, event_id, name, description, show_description_in_pdf, sort_order,
          timing_mode, from_point_id, to_point_id, start_finish_point_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          show_description_in_pdf = EXCLUDED.show_description_in_pdf,
          sort_order = EXCLUDED.sort_order,
          timing_mode = EXCLUDED.timing_mode,
          from_point_id = EXCLUDED.from_point_id,
          to_point_id = EXCLUDED.to_point_id,
          start_finish_point_id = EXCLUDED.start_finish_point_id`,
        [
          t.id,
          event.id,
          t.name,
          t.description || "",
          Boolean(t.showDescriptionInPdf),
          t.order,
          t.timingMode || "point_to_point",
          t.fromPointId || null,
          t.toPointId || null,
          t.startFinishPointId || t.fromPointId || null,
        ]
      );

      await q(client, `DELETE FROM test_partial_points WHERE test_id = $1`, [t.id]);
      const partials =
        t.partialPointIds && t.partialPointIds.length
          ? t.partialPointIds
          : t.toPointId
            ? [t.toPointId]
            : [];
      for (let i = 0; i < partials.length; i++) {
        await q(
          client,
          `INSERT INTO test_partial_points (test_id, event_id, timing_point_id, sort_order)
           VALUES ($1,$2,$3,$4)`,
          [t.id, event.id, partials[i], i]
        );
      }

      await q(
        client,
        `UPDATE test_parts SET sort_order = sort_order - 100000
         WHERE test_id = $1 AND sort_order >= 0`,
        [t.id]
      );

      for (const part of t.parts || []) {
        const scoring =
          part.combinedMode && !part.combinedScoring
            ? "time"
            : part.combinedScoring || null;
        await q(
          client,
          `INSERT INTO test_parts (
            id, test_id, event_id, name, sort_order, combined_mode, combined_scoring, expected_laps
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            sort_order = EXCLUDED.sort_order,
            combined_mode = EXCLUDED.combined_mode,
            combined_scoring = EXCLUDED.combined_scoring,
            expected_laps = EXCLUDED.expected_laps`,
          [
            part.id,
            t.id,
            event.id,
            part.name,
            part.order,
            Boolean(part.combinedMode),
            scoring,
            part.expectedLaps ?? null,
          ]
        );
      }
      await q(
        client,
        `DELETE FROM test_parts WHERE test_id = $1 AND NOT (id = ANY($2::uuid[]))`,
        [t.id, uuidList((t.parts || []).map((p) => p.id))]
      );

      await q(client, `DELETE FROM test_penalties WHERE test_id = $1`, [t.id]);
      for (const pen of t.penalties || []) {
        await q(
          client,
          `INSERT INTO test_penalties (
            test_id, pilot_number, scope, time_penalty_ms, position_penalty, comment
          ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            t.id,
            pen.number,
            pen.scope || "shared",
            pen.timePenaltyMs || 0,
            pen.positionPenalty || 0,
            pen.comment || "",
          ]
        );
      }
    }

    await q(
      client,
      `DELETE FROM tests WHERE event_id = $1 AND NOT (id = ANY($2::uuid[]))`,
      [event.id, uuidList((event.tests || []).map((t) => t.id))]
    );

    await q(client, `DELETE FROM fusions WHERE event_id = $1`, [event.id]);
    for (const fus of event.fusions || []) {
      await q(
        client,
        `INSERT INTO fusions (id, event_id, name, warning, created_at)
         VALUES ($1,$2,$3,$4,$5::timestamptz)`,
        [
          fus.id,
          event.id,
          fus.name,
          fus.warning ?? null,
          fus.createdAt || new Date().toISOString(),
        ]
      );
      for (let i = 0; i < (fus.tests || []).length; i++) {
        const ft = fus.tests[i];
        await q(
          client,
          `INSERT INTO fusion_tests (fusion_id, test_id, test_name, segment_label, sort_order)
           VALUES ($1,$2,$3,$4,$5)`,
          [fus.id, ft.id, ft.name, ft.segmentLabel || "", i]
        );
      }
      for (const row of fus.rows || []) {
        const rowId = randomUUID();
        await q(
          client,
          `INSERT INTO fusion_rows (
            id, fusion_id, position, number, name, category, league,
            total_time_ms, total_time_formatted, tests_count
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            rowId,
            fus.id,
            row.position,
            row.number,
            row.name || "",
            row.category || "",
            row.league || "",
            row.totalTimeMs,
            row.totalTimeFormatted,
            row.testsCount || 0,
          ]
        );
        for (const bt of row.byTest || []) {
          await q(
            client,
            `INSERT INTO fusion_row_times (
              fusion_row_id, test_id, test_name, segment_label, time_ms, time_formatted, laps
            ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              rowId,
              bt.testId,
              bt.testName || "",
              bt.segmentLabel || "",
              bt.timeMs,
              bt.timeFormatted || "—",
              bt.laps ?? null,
            ]
          );
        }
      }
    }

    await q(client, `DELETE FROM results_board WHERE event_id = $1`, [event.id]);
    for (const b of event.resultsBoard || []) {
      await q(
        client,
        `INSERT INTO results_board (
          id, event_id, kind, ref_id, part_id, title, published_at, sort_order
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8)`,
        [
          b.id,
          event.id,
          b.kind,
          b.refId,
          b.partId ?? null,
          b.title,
          b.publishedAt || new Date().toISOString(),
          b.order,
        ]
      );
    }
  });

  return event;
}

export async function removeEvent(id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM events WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
