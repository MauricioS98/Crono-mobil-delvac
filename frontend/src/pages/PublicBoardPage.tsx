import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { FusionRow, ResultRow } from "../types";

function isFusionRow(r: ResultRow | FusionRow): r is FusionRow {
  return "totalTimeFormatted" in r && "byTest" in r;
}

export function PublicBoardPage() {
  const { id } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getBoard>> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="board-page">
      <header className="board-hero">
        {headerUrl && (
          <img className="board-header-img" src={headerUrl} alt="" />
        )}
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
            <section key={section.entry.id} className="board-section">
              <header className="board-section-head">
                <span className="board-section-num">{idx + 1}</span>
                <div>
                  <h2>{section.title}</h2>
                  <p className="board-section-kind">
                    {section.kind === "fusion" ? "Fusión" : "Resultado unificado"}
                  </p>
                </div>
              </header>

              {section.warning && (
                <p className="board-warning">{section.warning}</p>
              )}

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
                      {section.rows.map((raw) => {
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
                        <th>Categoría</th>
                        <th>Liga</th>
                        {section.rows.some(
                          (r) => !isFusionRow(r) && r.laps != null && r.laps > 0
                        ) && <th>Vueltas</th>}
                        <th>Tiempo</th>
                        <th>Salida</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((raw) => {
                        const r = raw as ResultRow;
                        const showLaps = section.rows.some(
                          (x) => !isFusionRow(x) && x.laps != null && x.laps > 0
                        );
                        return (
                          <tr key={`${r.number}-${r.partId || "u"}`}>
                            <td className={r.position <= 3 ? `pos-${r.position}` : ""}>
                              {r.position}
                            </td>
                            <td>{r.number}</td>
                            <td>{r.name || "—"}</td>
                            <td>{r.category || "—"}</td>
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
                            <td className="time">{r.timeFormatted}</td>
                            <td>{r.partName || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <footer className="board-footer">
        <span>{event.footerText || "Gran Premio Mobil Delvac · Cronometraje GPMD"}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => load()}>
          Actualizar
        </button>
      </footer>
    </div>
  );
}
