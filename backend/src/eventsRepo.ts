import { randomUUID } from "crypto";
import type pg from "pg";
import { pool, withTransaction } from "./db.js";
import type {
  Event,
  FlagEvent,
  FlagType,
  FusionRow,
  Passage,
  Pilot,
  PilotPenalty,
  ResultsBoardEntry,
  SavedFusion,
  Test,
  TestPart,
  TestTimingMode,
  TimingPoint,
  TimingPointRole,
} from "./types.js";

type Q = pg.PoolClient | typeof pool;

async function q<T extends pg.QueryResultRow>(
  client: Q,
  text: string,
  params?: unknown[]
) {
  return client.query<T>(text, params);
}

function mapEventRow(row: Record<string, unknown>): Omit<
  Event,
  "timingPoints" | "pilots" | "tests" | "fusions" | "resultsBoard"
> {
  return {
    id: String(row.id),
    name: String(row.name),
    date: String(row.event_date ?? ""),
    location: String(row.location ?? ""),
    headerImage: (row.header_image as string | null) ?? null,
    footerText: String(row.footer_text ?? "Minerva Timing"),
    password: String(row.password),
    themeColors: (row.theme_colors as string[] | null) ?? null,
    boardPageSeconds: Number(row.board_page_seconds ?? 10),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapPassage(row: Record<string, unknown>): Passage & { is_race?: boolean } {
  return {
    number: String(row.number ?? ""),
    name: String(row.name ?? ""),
    tmPasosMs: Number(row.tm_pasos_ms ?? 0),
    tmPasosRaw: String(row.tm_pasos_raw ?? ""),
    lapTimeMs: row.lap_time_ms == null ? null : Number(row.lap_time_ms),
    lapTimeRaw: String(row.lap_time_raw ?? ""),
    lapsCount: row.laps_count == null ? null : Number(row.laps_count),
    elapsedMs: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    clase: String(row.clase ?? ""),
    rowIndex: Number(row.row_index ?? 0),
    is_race: Boolean(row.is_race),
  };
}

export async function loadEvent(id: string): Promise<Event | null> {
  const evRes = await q(pool, `SELECT * FROM events WHERE id = $1`, [id]);
  if (!evRes.rows[0]) return null;
  const base = mapEventRow(evRes.rows[0] as Record<string, unknown>);

  const [pointsRes, pilotsRes, testsRes, boardRes, fusionsRes] = await Promise.all([
    q(pool, `SELECT * FROM timing_points WHERE event_id = $1 ORDER BY sort_order`, [id]),
    q(pool, `SELECT * FROM pilots WHERE event_id = $1 ORDER BY number`, [id]),
    q(pool, `SELECT * FROM tests WHERE event_id = $1 ORDER BY sort_order`, [id]),
    q(pool, `SELECT * FROM results_board WHERE event_id = $1 ORDER BY sort_order`, [id]),
    q(pool, `SELECT * FROM fusions WHERE event_id = $1 ORDER BY created_at`, [id]),
  ]);

  const timingPoints: TimingPoint[] = pointsRes.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    offsetMs: Number(r.offset_ms ?? 0),
    order: Number(r.sort_order ?? 0),
    role: (r.role as TimingPointRole | null) || undefined,
  }));

  const pilots: Pilot[] = pilotsRes.rows.map((r) => ({
    id: String(r.id),
    number: String(r.number),
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    league: String(r.league ?? ""),
    notes: String(r.notes ?? ""),
  }));

  const testIds = testsRes.rows.map((r) => String(r.id));
  const partialsByTest = new Map<string, string[]>();
  const penaltiesByTest = new Map<string, PilotPenalty[]>();
  const partsByTest = new Map<string, TestPart[]>();

  if (testIds.length > 0) {
    const [partialsRes, penaltiesRes, partsRes] = await Promise.all([
      q(
        pool,
        `SELECT * FROM test_partial_points WHERE event_id = $1 ORDER BY sort_order`,
        [id]
      ),
      q(
        pool,
        `SELECT p.* FROM test_penalties p
         INNER JOIN tests t ON t.id = p.test_id
         WHERE t.event_id = $1`,
        [id]
      ),
      q(
        pool,
        `SELECT * FROM test_parts WHERE event_id = $1 ORDER BY sort_order`,
        [id]
      ),
    ]);

    for (const r of partialsRes.rows) {
      const tid = String(r.test_id);
      if (!partialsByTest.has(tid)) partialsByTest.set(tid, []);
      partialsByTest.get(tid)!.push(String(r.timing_point_id));
    }

    for (const r of penaltiesRes.rows) {
      const tid = String(r.test_id);
      if (!penaltiesByTest.has(tid)) penaltiesByTest.set(tid, []);
      penaltiesByTest.get(tid)!.push({
        number: String(r.pilot_number),
        scope: String(r.scope || "shared"),
        timePenaltyMs: Number(r.time_penalty_ms || 0),
        positionPenalty: Number(r.position_penalty || 0),
        comment: String(r.comment || ""),
      });
    }

    const partIds = partsRes.rows.map((r) => String(r.id));
    const csvsByPart = new Map<
      string,
      { timingPointId: string; filename: string; uploadId: string }[]
    >();

    if (partIds.length > 0) {
      const uploadsRes = await q(
        pool,
        `SELECT * FROM csv_uploads WHERE part_id = ANY($1::uuid[])`,
        [partIds]
      );
      const uploadIds = uploadsRes.rows.map((r) => String(r.id));

      for (const r of uploadsRes.rows) {
        const pid = String(r.part_id);
        if (!csvsByPart.has(pid)) csvsByPart.set(pid, []);
        csvsByPart.get(pid)!.push({
          uploadId: String(r.id),
          timingPointId: String(r.timing_point_id),
          filename: String(r.filename),
        });
      }

      const passagesByUpload = new Map<string, Passage[]>();
      const raceByUpload = new Map<string, Passage[]>();
      const flagsByUpload = new Map<string, FlagEvent[]>();

      if (uploadIds.length > 0) {
        const [passRes, flagRes] = await Promise.all([
          q(
            pool,
            `SELECT * FROM csv_passages WHERE csv_upload_id = ANY($1::uuid[]) ORDER BY row_index, id`,
            [uploadIds]
          ),
          q(
            pool,
            `SELECT * FROM csv_flags WHERE csv_upload_id = ANY($1::uuid[]) ORDER BY row_index, id`,
            [uploadIds]
          ),
        ]);

        for (const r of passRes.rows) {
          const uid = String(r.csv_upload_id);
          const p = mapPassage(r as Record<string, unknown>);
          const { is_race, ...passage } = p;
          if (!passagesByUpload.has(uid)) passagesByUpload.set(uid, []);
          passagesByUpload.get(uid)!.push(passage);
          if (is_race) {
            if (!raceByUpload.has(uid)) raceByUpload.set(uid, []);
            raceByUpload.get(uid)!.push(passage);
          }
        }

        for (const r of flagRes.rows) {
          const uid = String(r.csv_upload_id);
          if (!flagsByUpload.has(uid)) flagsByUpload.set(uid, []);
          flagsByUpload.get(uid)!.push({
            type: String(r.flag_type) as FlagType,
            tmPasosMs: Number(r.tm_pasos_ms || 0),
            tmPasosRaw: String(r.tm_pasos_raw || ""),
            label: String(r.label || ""),
            rowIndex: Number(r.row_index || 0),
          });
        }
      }

      for (const r of partsRes.rows) {
        const partId = String(r.id);
        const testId = String(r.test_id);
        const slots = csvsByPart.get(partId) || [];
        const part: TestPart = {
          id: partId,
          name: String(r.name),
          order: Number(r.sort_order || 0),
          combinedMode: Boolean(r.combined_mode),
          combinedScoring: r.combined_scoring
            ? (String(r.combined_scoring) as "time" | "laps")
            : undefined,
          expectedLaps: r.expected_laps == null ? null : Number(r.expected_laps),
          csvs: slots.map((s) => {
            const passages = passagesByUpload.get(s.uploadId) || [];
            const racePassages = raceByUpload.get(s.uploadId) || [];
            return {
              timingPointId: s.timingPointId,
              filename: s.filename,
              parsed: {
                filename: s.filename,
                passages,
                racePassages,
                flags: flagsByUpload.get(s.uploadId) || [],
              },
            };
          }),
        };
        // If is_race flags missing, fall back: racePassages = all passages (legacy dumps)
        for (const slot of part.csvs) {
          if (slot.parsed.racePassages.length === 0 && slot.parsed.passages.length > 0) {
            slot.parsed.racePassages = [...slot.parsed.passages];
          }
        }
        if (!partsByTest.has(testId)) partsByTest.set(testId, []);
        partsByTest.get(testId)!.push(part);
      }
    } else {
      for (const r of partsRes.rows) {
        const testId = String(r.test_id);
        if (!partsByTest.has(testId)) partsByTest.set(testId, []);
        partsByTest.get(testId)!.push({
          id: String(r.id),
          name: String(r.name),
          order: Number(r.sort_order || 0),
          combinedMode: Boolean(r.combined_mode),
          combinedScoring: r.combined_scoring
            ? (String(r.combined_scoring) as "time" | "laps")
            : undefined,
          expectedLaps: r.expected_laps == null ? null : Number(r.expected_laps),
          csvs: [],
        });
      }
    }
  }

  const tests: Test[] = testsRes.rows.map((r) => {
    const tid = String(r.id);
    return {
      id: tid,
      name: String(r.name),
      description: String(r.description ?? ""),
      showDescriptionInPdf: Boolean(r.show_description_in_pdf),
      order: Number(r.sort_order || 0),
      timingMode: (String(r.timing_mode || "point_to_point") as TestTimingMode),
      fromPointId: r.from_point_id ? String(r.from_point_id) : null,
      toPointId: r.to_point_id ? String(r.to_point_id) : null,
      startFinishPointId: r.start_finish_point_id
        ? String(r.start_finish_point_id)
        : null,
      partialPointIds: partialsByTest.get(tid) || [],
      parts: partsByTest.get(tid) || [],
      penalties: penaltiesByTest.get(tid) || [],
    };
  });

  const fusions: SavedFusion[] = [];
  for (const fr of fusionsRes.rows) {
    const fid = String(fr.id);
    const [ftRes, rowRes] = await Promise.all([
      q(
        pool,
        `SELECT * FROM fusion_tests WHERE fusion_id = $1 ORDER BY sort_order`,
        [fid]
      ),
      q(
        pool,
        `SELECT * FROM fusion_rows WHERE fusion_id = $1 ORDER BY position`,
        [fid]
      ),
    ]);
    const rowIds = rowRes.rows.map((r) => String(r.id));
    const timesByRow = new Map<string, FusionRow["byTest"]>();
    if (rowIds.length > 0) {
      const timesRes = await q(
        pool,
        `SELECT * FROM fusion_row_times WHERE fusion_row_id = ANY($1::uuid[])`,
        [rowIds]
      );
      for (const t of timesRes.rows) {
        const rid = String(t.fusion_row_id);
        if (!timesByRow.has(rid)) timesByRow.set(rid, []);
        timesByRow.get(rid)!.push({
          testId: String(t.test_id),
          testName: String(t.test_name || ""),
          segmentLabel: String(t.segment_label || ""),
          timeMs: t.time_ms == null ? null : Number(t.time_ms),
          timeFormatted: String(t.time_formatted || "—"),
          laps: t.laps == null ? undefined : Number(t.laps),
        });
      }
    }

    fusions.push({
      id: fid,
      name: String(fr.name),
      testIds: ftRes.rows.map((t) => String(t.test_id)),
      tests: ftRes.rows.map((t) => ({
        id: String(t.test_id),
        name: String(t.test_name),
        segmentLabel: String(t.segment_label || ""),
      })),
      rows: rowRes.rows.map((r) => ({
        position: Number(r.position),
        number: String(r.number),
        name: String(r.name || ""),
        category: String(r.category || ""),
        league: String(r.league || ""),
        totalTimeMs: Number(r.total_time_ms),
        totalTimeFormatted: String(r.total_time_formatted),
        testsCount: Number(r.tests_count || 0),
        byTest: timesByRow.get(String(r.id)) || [],
      })),
      warning: fr.warning == null ? null : String(fr.warning),
      createdAt: new Date(String(fr.created_at)).toISOString(),
    });
  }

  const resultsBoard: ResultsBoardEntry[] = boardRes.rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as "unified" | "fusion",
    refId: String(r.ref_id),
    partId: r.part_id ? String(r.part_id) : null,
    title: String(r.title),
    publishedAt: new Date(String(r.published_at)).toISOString(),
    order: Number(r.sort_order || 0),
  }));

  return {
    ...base,
    timingPoints,
    pilots,
    tests,
    fusions,
    resultsBoard,
  };
}

export async function listEventIds(): Promise<string[]> {
  const r = await q<{ id: string }>(
    pool,
    `SELECT id FROM events ORDER BY updated_at DESC`
  );
  return r.rows.map((row) => String(row.id));
}

export async function loadAllEvents(): Promise<Event[]> {
  const ids = await listEventIds();
  const events: Event[] = [];
  for (const id of ids) {
    const e = await loadEvent(id);
    if (e) events.push(e);
  }
  return events;
}

async function insertEventTree(client: pg.PoolClient, event: Event): Promise<void> {
  const theme =
    event.themeColors && event.themeColors.length
      ? event.themeColors
      : null;

  await q(
    client,
    `INSERT INTO events (
      id, name, event_date, location, header_image, footer_text, password,
      theme_colors, board_page_seconds, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)`,
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
      event.createdAt || new Date().toISOString(),
      event.updatedAt || new Date().toISOString(),
    ]
  );

  for (const p of event.timingPoints || []) {
    await q(
      client,
      `INSERT INTO timing_points (id, event_id, name, offset_ms, sort_order, role)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, event.id, p.name, p.offsetMs || 0, p.order, p.role ?? null]
    );
  }

  for (const p of event.pilots || []) {
    await q(
      client,
      `INSERT INTO pilots (id, event_id, number, name, category, league, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
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

  for (const t of event.tests || []) {
    await q(
      client,
      `INSERT INTO tests (
        id, event_id, name, description, show_description_in_pdf, sort_order,
        timing_mode, from_point_id, to_point_id, start_finish_point_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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

    for (const part of t.parts || []) {
      const scoring =
        part.combinedMode && !part.combinedScoring
          ? "time"
          : part.combinedScoring || null;
      await q(
        client,
        `INSERT INTO test_parts (
          id, test_id, event_id, name, sort_order, combined_mode, combined_scoring, expected_laps
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
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

      for (const slot of part.csvs || []) {
        const uploadId = randomUUID();
        await q(
          client,
          `INSERT INTO csv_uploads (id, part_id, timing_point_id, filename, uploaded_at)
           VALUES ($1,$2,$3,$4, now())`,
          [uploadId, part.id, slot.timingPointId, slot.filename]
        );

        const parsed = slot.parsed || {
          filename: slot.filename,
          passages: [],
          racePassages: [],
          flags: [],
        };
        const raceKeys = new Set(
          (parsed.racePassages || []).map(
            (r) => `${r.rowIndex}|${r.number}|${r.tmPasosMs}`
          )
        );

        for (const pass of parsed.passages || []) {
          const key = `${pass.rowIndex}|${pass.number}|${pass.tmPasosMs}`;
          const isRace =
            raceKeys.has(key) ||
            (parsed.racePassages || []).some(
              (r) =>
                r.rowIndex === pass.rowIndex &&
                String(r.number) === String(pass.number)
            );
          await q(
            client,
            `INSERT INTO csv_passages (
              csv_upload_id, number, name, tm_pasos_ms, tm_pasos_raw,
              lap_time_ms, lap_time_raw, laps_count, elapsed_ms, clase, row_index, is_race
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
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
              isRace,
            ]
          );
        }

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
    }

    for (const pen of t.penalties || []) {
      await q(
        client,
        `INSERT INTO test_penalties (
          test_id, pilot_number, scope, time_penalty_ms, position_penalty, comment
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (test_id, pilot_number) DO UPDATE SET
          scope = EXCLUDED.scope,
          time_penalty_ms = EXCLUDED.time_penalty_ms,
          position_penalty = EXCLUDED.position_penalty,
          comment = EXCLUDED.comment`,
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
}

/** Full replace of an event tree inside a single ACID transaction. */
export async function persistEvent(event: Event): Promise<Event> {
  event.updatedAt = new Date().toISOString();
  if (!event.createdAt) event.createdAt = event.updatedAt;

  await withTransaction(async (client) => {
    await q(client, `DELETE FROM events WHERE id = $1`, [event.id]);
    await insertEventTree(client, event);
  });

  return event;
}

export async function removeEvent(id: string): Promise<boolean> {
  const r = await q(pool, `DELETE FROM events WHERE id = $1`, [id]);
  return (r.rowCount ?? 0) > 0;
}
