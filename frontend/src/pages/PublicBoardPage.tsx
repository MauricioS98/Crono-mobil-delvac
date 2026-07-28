import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatPenaltyInput } from "../api";
import { resolveThemeColors } from "../theme";
import type { FusionRow, ResultRow } from "../types";
import type { CSSProperties } from "react";

const BOARD_PAGE_SIZE = 10;

function isFusionRow(r: ResultRow | FusionRow): r is FusionRow {
  return "totalTimeFormatted" in r && "byTest" in r;
}

function formatPosPenalty(n: number | undefined): string {
  if (!n || n <= 0) return "—";
  return `+${n}`;
}

function segmentLabelsFor(rows: (ResultRow | FusionRow)[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    if (isFusionRow(raw)) continue;
    for (const s of raw.segments || []) {
      const key = `${s.from}→${s.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        labels.push(key);
      }
    }
  }
  return labels;
}

type BoardData = Awaited<ReturnType<typeof api.getBoard>>;
type BoardSection = BoardData["sections"][number];

function BoardSectionBlock({
  section,
  idx,
  eventId,
  pageIndex,
  pageSeconds,
}: {
  section: BoardSection;
  idx: number;
  eventId: string;
  pageIndex: number;
  pageSeconds: number;
}) {
  const totalPages = Math.max(1, Math.ceil(section.rows.length / BOARD_PAGE_SIZE));
  const safePage = ((pageIndex % totalPages) + totalPages) % totalPages;
  const pageRows = section.rows.slice(
    safePage * BOARD_PAGE_SIZE,
    safePage * BOARD_PAGE_SIZE + BOARD_PAGE_SIZE
  );
  const showLaps = section.rows.some(
    (r) => !isFusionRow(r) && r.laps != null && r.laps > 0
  );
  const showCategory = section.rows.some(
    (r) => !isFusionRow(r) && Boolean(r.category?.trim())
  );
  const showPenalties = section.kind !== "fusion";
  const segLabels = segmentLabelsFor(section.rows);
  const hasSegments = segLabels.length > 0;

  return (
    <section className="board-section">
      <header className="board-section-head">
        <span className="board-section-num">{idx + 1}</span>
        <div>
          <h2>{section.title}</h2>
          <p className="board-section-kind">
            {section.kind === "fusion"
              ? "Fusión"
              : section.entry.partId
                ? "Salida"
                : "Resultado unificado"}
            {section.rows.length > 0 && (
              <>
                {" · "}
                {section.rows.length} piloto{section.rows.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
        <div className="board-section-meta">
          {totalPages > 1 && (
            <span className="board-page-badge" title={`Cambia cada ${pageSeconds}s`}>
              Pág. {safePage + 1}/{totalPages}
            </span>
          )}
          <div className="board-section-actions">
            <span className="board-export-label">Descargar</span>
            {(["pdf", "csv", "xlsx"] as const).map((fmt) => (
              <a
                key={fmt}
                className="board-export-btn"
                href={
                  section.kind === "fusion"
                    ? `/api/events/${eventId}/fusions/${section.entry.refId}/export/${fmt}`
                    : `/api/events/${eventId}/tests/${section.entry.refId}/export/${fmt}`
                }
              >
                {fmt === "xlsx" ? "Excel" : fmt.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
      </header>

      {section.warning && <p className="board-warning">{section.warning}</p>}

      {section.rows.length === 0 ? (
        <p className="board-empty-sm">Sin tiempos para mostrar.</p>
      ) : section.kind === "fusion" && section.tests ? (
        <div className="table-wrap board-table-wrap">
          <table className="results-table board-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>N°</th>
                <th>Nombre</th>
                {section.tests.map((t) => (
                  <th key={t.id}>
                    <span>{t.name}</span>
                    <span className="board-col-sub">{t.segmentLabel}</span>
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((raw) => {
                const r = raw as FusionRow;
                return (
                  <tr key={r.number}>
                    <td className={r.position <= 3 ? `pos-${r.position}` : ""}>
                      {r.position}
                    </td>
                    <td>{r.number}</td>
                    <td>{r.name || "—"}</td>
                    {r.byTest.map((t) => (
                      <td key={t.testId} className="time">
                        {t.timeFormatted}
                      </td>
                    ))}
                    <td className="time board-total">{r.totalTimeFormatted}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap board-table-wrap">
          <table className="results-table board-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>N°</th>
                <th>Nombre</th>
                {showCategory && <th>Categoría</th>}
                <th>Liga</th>
                {showLaps && <th>Vueltas</th>}
                {segLabels.map((label) => (
                  <th key={label}>{label}</th>
                ))}
                <th>{hasSegments ? "Total" : "Tiempo"}</th>
                {showPenalties && (
                  <>
                    <th>Sin pen.</th>
                    <th>Pen. tiempo</th>
                    <th>Pen. pos</th>
                    <th>Comentario</th>
                  </>
                )}
                <th>Salida</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((raw) => {
                const r = raw as ResultRow;
                return (
                  <tr
                    key={`${r.number}-${r.partId || "u"}`}
                    className={r.hasPenalty ? "row-penalty" : undefined}
                  >
                    <td className={r.position <= 3 ? `pos-${r.position}` : ""}>
                      {r.position}
                    </td>
                    <td>{r.number}</td>
                    <td>{r.name || "—"}</td>
                    {showCategory && <td>{r.category || "—"}</td>}
                    <td>{r.league || "—"}</td>
                    {showLaps && (
                      <td>
                        {r.laps == null
                          ? "—"
                          : r.expectedLaps != null
                            ? `${r.laps}/${r.expectedLaps}`
                            : r.laps}
                      </td>
                    )}
                    {segLabels.map((label) => {
                      const seg = (r.segments || []).find(
                        (s) => `${s.from}→${s.to}` === label
                      );
                      return (
                        <td key={label} className="time">
                          {seg?.timeFormatted || "—"}
                        </td>
                      );
                    })}
                    <td className="time">{r.timeFormatted}</td>
                    {showPenalties && (
                      <>
                        <td className="time muted">
                          {r.hasPenalty ? r.rawTimeFormatted : "—"}
                        </td>
                        <td className="time">
                          {r.timePenaltyMs > 0
                            ? formatPenaltyInput(r.timePenaltyMs)
                            : "—"}
                        </td>
                        <td>{formatPosPenalty(r.positionPenalty)}</td>
                        <td className="board-comment">{r.comment || "—"}</td>
                      </>
                    )}
                    <td>{r.partName || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PublicBoardPage() {
  const { id } = useParams();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageBySection, setPageBySection] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const board = await api.getBoard(id);
      setData(board);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar el tablero");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [id, load]);

  const pageSeconds = Math.min(
    120,
    Math.max(3, Math.round(data?.event.boardPageSeconds ?? 10))
  );

  const sectionIds = useMemo(
    () => (data?.sections || []).map((s) => s.entry.id).join("|"),
    [data?.sections]
  );

  useEffect(() => {
    if (!data || data.sections.length === 0) return;
    const timer = window.setInterval(() => {
      setPageBySection((prev) => {
        const next = { ...prev };
        for (const section of data.sections) {
          const pages = Math.max(1, Math.ceil(section.rows.length / BOARD_PAGE_SIZE));
          if (pages <= 1) {
            next[section.entry.id] = 0;
            continue;
          }
          const cur = prev[section.entry.id] || 0;
          next[section.entry.id] = (cur + 1) % pages;
        }
        return next;
      });
    }, pageSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [data, pageSeconds, sectionIds]);

  if (loading) {
    return (
      <div className="board-page">
        <div className="board-empty">Cargando resultados…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="board-page">
        <div className="board-empty">{error || "Tablero no encontrado"}</div>
        <p className="board-back">
          <Link to="/">Volver a eventos</Link>
        </p>
      </div>
    );
  }

  const { event, sections } = data;
  const headerUrl = event.headerImage ? `/uploads/headers/${event.headerImage}` : null;
  const origin = window.location.origin;
  const [cAccent, cAccent2] = resolveThemeColors(event.themeColors);
  const boardTheme = {
    "--accent": cAccent,
    "--accent-hot": cAccent2,
  } as CSSProperties;

  return (
    <div className="board-page" style={boardTheme}>
      <header className="board-hero">
        {headerUrl && <img className="board-header-img" src={headerUrl} alt="" />}
        <div className="board-hero-text">
          <p className="board-kicker">Resultados en vivo</p>
          <h1>{event.name}</h1>
          {(event.date || event.location) && (
            <p className="board-meta">
              {[event.date, event.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>

      {sections.length === 0 ? (
        <div className="board-empty">
          Aún no hay resultados publicados. Desde el panel del evento, usa «Publicar en
          tablero» en un resultado unificado o en una fusión guardada.
        </div>
      ) : (
        <div className="board-sections">
          {sections.map((section, idx) => (
            <BoardSectionBlock
              key={section.entry.id}
              section={section}
              idx={idx}
              eventId={event.id}
              pageIndex={pageBySection[section.entry.id] || 0}
              pageSeconds={pageSeconds}
            />
          ))}
        </div>
      )}

      <details className="board-broadcast">
        <summary>Transmisión — overlay y feeds de datos</summary>
        <div className="board-broadcast-body">
          <p>
            Para superponer los resultados sobre la señal de video (OBS / vMix), agrega el
            overlay como «browser source» con fondo transparente. Los sistemas de gráficos
            también pueden leer los feeds de datos, que se actualizan en cada consulta.
          </p>
          <div className="broadcast-url-row">
            <strong>Overlay (OBS/vMix)</strong>
            <code>{`${origin}/overlay/${event.id}`}</code>
          </div>
          <div className="broadcast-url-row">
            <strong>Feed JSON</strong>
            <code>{`${origin}/api/events/${event.id}/board/feed.json`}</code>
          </div>
          <div className="broadcast-url-row">
            <strong>Feed CSV</strong>
            <code>{`${origin}/api/events/${event.id}/board/feed.csv`}</code>
          </div>
          <div className="broadcast-url-row">
            <strong>Feed XML</strong>
            <code>{`${origin}/api/events/${event.id}/board/feed.xml`}</code>
          </div>
          <p>
            Parámetros del overlay: <code>?section=2</code> (sección por número o id;
            por defecto la última publicada), <code>top=20</code> (filas),{" "}
            <code>refresh=5</code> (segundos), <code>gap=0</code> (ocultar la diferencia con
            el líder) y <code>header=0</code> (ocultar título). En los feeds,{" "}
            <code>?section=2</code> filtra una sola sección. El tablero público pagina de 10
            en 10 cada {pageSeconds}s (configurable en el panel).
          </p>
        </div>
      </details>

      <footer className="board-footer">
        <span>
          {event.footerText || "Minerva Timing"}
          {sections.some((s) => s.rows.length > BOARD_PAGE_SIZE)
            ? ` · Página cada ${pageSeconds}s`
            : ""}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => load()}>
          Actualizar
        </button>
      </footer>
    </div>
  );
}
