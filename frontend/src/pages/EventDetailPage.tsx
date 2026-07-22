import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatOffsetInput } from "../api";
import type { Event, ResultRow, Test, TestPart, TimingPoint } from "../types";

function msFromOffset(raw: string): number {
  let s = raw.trim().replace(",", ".");
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const parts = s.split(":");
  let ms = 0;
  if (parts.length === 4) {
    // hh:mm:ss:xxx
    ms =
      Number(parts[0]) * 3600000 +
      Number(parts[1]) * 60000 +
      Number(parts[2]) * 1000 +
      Number(parts[3]);
  } else if (parts.length === 3) {
    ms = Number(parts[0]) * 3600000 + Number(parts[1]) * 60000 + Number(parts[2]) * 1000;
  } else if (parts.length === 2) {
    ms = Number(parts[0]) * 60000 + Number(parts[1]) * 1000;
  }
  return neg ? -ms : ms;
}

export function EventDetailPage() {
  const { id } = useParams();
  const [event, setEvent] = useState<Event | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [resultsTitle, setResultsTitle] = useState("");
  const [resultsWarning, setResultsWarning] = useState("");
  const [resultsPartId, setResultsPartId] = useState<string | undefined>();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    const ev = await api.getEvent(id);
    setEvent(ev);
    setOffsetDrafts(
      Object.fromEntries(ev.timingPoints.map((p) => [p.id, formatOffsetInput(p.offsetMs)]))
    );
    const sorted = [...ev.timingPoints].sort((a, b) => a.order - b.order);
    if (!fromId && sorted[0]) setFromId(sorted[0].id);
    if (!toId && sorted[1]) setToId(sorted[1].id);
    if (!selectedTestId && ev.tests[0]) setSelectedTestId(ev.tests[0].id);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const selectedTest: Test | undefined = useMemo(
    () => event?.tests.find((t) => t.id === selectedTestId),
    [event, selectedTestId]
  );

  const selectedPart: TestPart | undefined = useMemo(
    () => selectedTest?.parts.find((p) => p.id === selectedPartId),
    [selectedTest, selectedPartId]
  );

  const refreshResults = async (partId?: string | null) => {
    if (!event || !selectedTestId) return;
    const pid = partId || undefined;
    setError("");
    try {
      const data = await api.getResults(event.id, selectedTestId, {
        from: fromId,
        to: toId,
        partId: pid,
      });
      setResults(data.rows);
      setResultsTitle(data.title);
      setResultsWarning(data.warning || "");
      setResultsPartId(pid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al calcular resultados");
    }
  };

  if (!event) {
    return <div className="empty">{error || "Cargando evento…"}</div>;
  }

  const points = [...event.timingPoints].sort((a, b) => a.order - b.order);

  const saveMeta = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await api.updateEvent(event.id, {
      name: String(fd.get("name") || ""),
      date: String(fd.get("date") || ""),
      location: String(fd.get("location") || ""),
      footerText: String(fd.get("footerText") || ""),
    });
    setMsg("Evento actualizado");
    load();
  };

  const saveTimingPoints = async () => {
    const payload = points.map((p, i) => ({
      ...p,
      order: i,
      offsetMs: i === 0 ? 0 : msFromOffset(offsetDrafts[p.id] || "0"),
    }));
    await api.updateTimingPoints(event.id, payload);
    setMsg("Puntos de cronometraje guardados (desfases relativos a PC A)");
    await load();
  };

  const addPoint = async () => {
    const next = String.fromCharCode(65 + points.length);
    const payload: TimingPoint[] = [
      ...points,
      { id: crypto.randomUUID(), name: `PC ${next}`, offsetMs: 0, order: points.length },
    ];
    await api.updateTimingPoints(event.id, payload);
    await load();
  };

  const removePoint = async (pointId: string) => {
    if (points.length <= 2) {
      setError("Se necesitan al menos 2 puntos (A y B)");
      return;
    }
    if (points[0]?.id === pointId) {
      setError("No se puede eliminar el punto de referencia (PC A)");
      return;
    }
    await api.updateTimingPoints(
      event.id,
      points.filter((p) => p.id !== pointId).map((p, i) => ({ ...p, order: i }))
    );
    await load();
  };

  const onHeader = async (file: File | null) => {
    if (!file) return;
    await api.uploadHeader(event.id, file);
    setMsg("Imagen de cabecera actualizada");
    load();
  };

  const addTest = async () => {
    const name = prompt("Nombre de la prueba", `Prueba ${event.tests.length + 1}`);
    if (!name) return;
    const t = (await api.createTest(event.id, name)) as Test;
    await load();
    setSelectedTestId(t.id);
  };

  const addPart = async () => {
    if (!selectedTestId) return;
    const name = prompt("Nombre de la parte / salida", `Salida ${(selectedTest?.parts.length || 0) + 1}`);
    if (!name) return;
    const p = (await api.createPart(event.id, selectedTestId, { name, combinedMode: false })) as TestPart;
    await load();
    setSelectedPartId(p.id);
  };

  const uploadCsv = async (timingPointId: string, file: File) => {
    if (!selectedTestId || !selectedPartId || !selectedPart) return;
    setError("");
    try {
      const res = await api.uploadCsv(
        event.id,
        selectedTestId,
        selectedPartId,
        file,
        timingPointId,
        selectedPart.combinedMode
      );
      const summary = res.summary as { uniquePilots: number; flags: { type: string; label: string }[] };
      setMsg(
        `CSV cargado: ${summary.uniquePilots} pilotos en carrera` +
          (summary.flags?.length ? ` · Banderas: ${summary.flags.map((f) => f.label).join(", ")}` : "")
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al subir CSV");
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="muted" style={{ marginBottom: "0.35rem" }}>
            <Link to="/">← Eventos</Link>
          </p>
          <h1>{event.name}</h1>
          <p>
            {[event.date, event.location].filter(Boolean).join(" · ") || "Configura fecha y lugar"}
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}
      {msg && <div className="alert" style={{ marginBottom: "1rem" }}>{msg}</div>}

      <div className="grid grid-2">
        <form className="card form" onSubmit={saveMeta}>
          <h3>Datos del evento</h3>
          <div className="field">
            <label>Nombre</label>
            <input name="name" defaultValue={event.name} required />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input name="date" type="date" defaultValue={event.date} />
          </div>
          <div className="field">
            <label>Lugar</label>
            <input name="location" defaultValue={event.location} />
          </div>
          <div className="field">
            <label>Texto pie de página (PDF)</label>
            <input name="footerText" defaultValue={event.footerText} />
          </div>
          <div className="field">
            <label>Imagen de cabecera (todo el evento)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onHeader(e.target.files?.[0] || null)}
            />
            {event.headerImage && (
              <img
                className="header-preview"
                src={`/uploads/headers/${event.headerImage}?t=${event.updatedAt}`}
                alt="Cabecera"
              />
            )}
          </div>
          <button className="btn btn-primary">Guardar datos</button>
        </form>

        <div className="card stack">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--display)", textTransform: "uppercase" }}>
              Puntos de cronometraje
            </h3>
            <button className="btn btn-secondary btn-sm" type="button" onClick={addPoint}>
              + Punto
            </button>
          </div>
          <p className="muted">
            El primer punto es la referencia (desfase 0). Los demás desfases son relativos a PC A,
            formato <code>hh:mm:ss.xxx</code> (también acepta <code>hh:mm:ss:xxx</code>).
          </p>
          {points.map((p, i) => (
            <div key={p.id} className="timing-point-row">
              <div className="field">
                <label>Nombre</label>
                <input
                  value={p.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setEvent({
                      ...event,
                      timingPoints: event.timingPoints.map((tp) =>
                        tp.id === p.id ? { ...tp, name } : tp
                      ),
                    });
                  }}
                />
              </div>
              <div className="field">
                <label>Desfase</label>
                <input
                  value={i === 0 ? "00:00:00.000" : offsetDrafts[p.id] || "00:00:00.000"}
                  disabled={i === 0}
                  onChange={(e) => setOffsetDrafts({ ...offsetDrafts, [p.id]: e.target.value })}
                  placeholder="00:02:36.245"
                />
              </div>
              {i > 0 ? (
                <button
                  className="btn btn-danger btn-sm row-action"
                  type="button"
                  onClick={() => removePoint(p.id)}
                  aria-label={`Eliminar ${p.name}`}
                >
                  ×
                </button>
              ) : (
                <span className="row-action-spacer" aria-hidden="true" />
              )}
            </div>
          ))}
          <button className="btn btn-primary" type="button" onClick={saveTimingPoints}>
            Guardar puntos y desfases
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h2>Pruebas</h2>
          <button className="btn btn-secondary" onClick={addTest}>
            + Nueva prueba
          </button>
        </div>

        {event.tests.length === 0 ? (
          <div className="empty">Crea una prueba (manga / categoría) para empezar a cargar CSV.</div>
        ) : (
          <div className="split">
            <div className="card side-list stack">
              {event.tests.map((t) => (
                <button
                  key={t.id}
                  className={selectedTestId === t.id ? "active" : ""}
                  onClick={() => {
                    setSelectedTestId(t.id);
                    setSelectedPartId(t.parts[0]?.id || null);
                    setResults([]);
                  }}
                >
                  <strong>{t.name}</strong>
                  <div className="muted">{t.parts.length} parte(s)</div>
                </button>
              ))}
              {selectedTest && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    if (!confirm("¿Eliminar prueba?")) return;
                    await api.deleteTest(event.id, selectedTest.id);
                    setSelectedTestId(null);
                    load();
                  }}
                >
                  Eliminar prueba
                </button>
              )}
            </div>

            {selectedTest && (
              <div className="stack">
                <div className="card stack">
                  <div className="section-head" style={{ marginBottom: 0 }}>
                    <h3 style={{ margin: 0 }}>{selectedTest.name}</h3>
                    <button className="btn btn-secondary btn-sm" onClick={addPart}>
                      + Parte / salida
                    </button>
                  </div>

                  <div className="field">
                    <label>Descripción</label>
                    <textarea
                      rows={3}
                      value={selectedTest.description || ""}
                      placeholder="Notas de la prueba, condiciones, observaciones…"
                      onChange={(e) => {
                        const description = e.target.value;
                        setEvent({
                          ...event,
                          tests: event.tests.map((t) =>
                            t.id === selectedTest.id ? { ...t, description } : t
                          ),
                        });
                      }}
                    />
                  </div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedTest.showDescriptionInPdf)}
                      onChange={(e) => {
                        const showDescriptionInPdf = e.target.checked;
                        setEvent({
                          ...event,
                          tests: event.tests.map((t) =>
                            t.id === selectedTest.id ? { ...t, showDescriptionInPdf } : t
                          ),
                        });
                      }}
                    />
                    Mostrar descripción en el PDF
                  </label>
                  <div className="actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={async () => {
                        await api.updateTest(event.id, selectedTest.id, {
                          description: selectedTest.description || "",
                          showDescriptionInPdf: Boolean(selectedTest.showDescriptionInPdf),
                        });
                        setMsg("Datos de la prueba guardados");
                        load();
                      }}
                    >
                      Guardar descripción
                    </button>
                  </div>

                  <div className="tabs">
                    {selectedTest.parts.map((p) => (
                      <button
                        key={p.id}
                        className={`tab ${selectedPartId === p.id ? "active" : ""}`}
                        onClick={() => setSelectedPartId(p.id)}
                      >
                        {p.name}
                        {p.combinedMode ? " · comb." : ""}
                      </button>
                    ))}
                  </div>

                  {!selectedPart && (
                    <div className="empty">Agrega una parte (salida) para cargar los CSV.</div>
                  )}

                  {selectedPart && (
                    <div className="stack">
                      <div className="row-inline">
                        <span className="chip">{selectedPart.combinedMode ? "CSV combinado" : "CSV por punto"}</span>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            await api.updatePart(event.id, selectedTest.id, selectedPart.id, {
                              combinedMode: !selectedPart.combinedMode,
                            });
                            load();
                          }}
                        >
                          Cambiar modo
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async () => {
                            if (!confirm("¿Eliminar parte?")) return;
                            await api.deletePart(event.id, selectedTest.id, selectedPart.id);
                            setSelectedPartId(null);
                            load();
                          }}
                        >
                          Eliminar parte
                        </button>
                      </div>

                      {selectedPart.combinedMode ? (
                        <CsvDrop
                          label="CSV único (Tiempo de vuelta ≠ 0 = tiempo de carrera)"
                          filename={selectedPart.csvs[0]?.filename}
                          onFile={(f) => uploadCsv(points[0]?.id || "combined", f)}
                        />
                      ) : (
                        <div className="grid grid-2">
                          {points.map((p) => {
                            const slot = selectedPart.csvs.find((c) => c.timingPointId === p.id);
                            return (
                              <CsvDrop
                                key={p.id}
                                label={`CSV · ${p.name}`}
                                filename={slot?.filename}
                                onFile={(f) => uploadCsv(p.id, f)}
                              />
                            );
                          })}
                        </div>
                      )}

                      <div className="actions">
                        <button
                          className="btn btn-secondary"
                          onClick={() => refreshResults(selectedPart.id)}
                        >
                          Resultado parcial de esta parte
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="card stack">
                  <div className="section-head" style={{ marginBottom: 0 }}>
                    <h3 style={{ margin: 0 }}>Resultados</h3>
                  </div>
                  <div className="row-inline">
                    <div className="field">
                      <label>Desde</label>
                      <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                        {points.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Hasta</label>
                      <select value={toId} onChange={(e) => setToId(e.target.value)}>
                        {points.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="btn btn-primary" onClick={() => refreshResults(null)}>
                      Unificado (mejor tiempo)
                    </button>
                  </div>

                  {resultsTitle && <p className="muted">{resultsTitle}</p>}
                  {resultsWarning && (
                    <div className="alert alert-error">{resultsWarning}</div>
                  )}

                  {resultsTitle && results.length === 0 && !resultsWarning && (
                    <div className="empty">Sin resultados para mostrar.</div>
                  )}

                  {results.length > 0 && (
                    <>
                      <div className="actions">
                        {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                          <a
                            key={fmt}
                            className="btn btn-secondary btn-sm"
                            href={api.exportUrl(event.id, selectedTest.id, fmt, {
                              from: fromId,
                              to: toId,
                              partId: resultsPartId,
                            })}
                          >
                            Exportar {fmt.toUpperCase()}
                          </a>
                        ))}
                      </div>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Pos</th>
                              <th>N°</th>
                              <th>Nombre</th>
                              <th>Categoría</th>
                              <th>Liga</th>
                              <th>Tiempo</th>
                              <th>Parte</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.map((r) => (
                              <tr key={`${r.number}-${r.partId || "u"}`}>
                                <td className={r.position <= 3 ? `pos-${r.position}` : ""}>
                                  {r.position}
                                </td>
                                <td>{r.number}</td>
                                <td>
                                  {r.name}
                                  {r.missingPilot && (
                                    <span className="badge-warn"> · sin ficha</span>
                                  )}
                                </td>
                                <td>{r.category || "—"}</td>
                                <td>{r.league || "—"}</td>
                                <td className="time">{r.timeFormatted}</td>
                                <td>{r.partName || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CsvDrop({
  label,
  filename,
  onFile,
}: {
  label: string;
  filename?: string;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      className={`dropzone ${drag ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <strong>{label}</strong>
      <div style={{ marginTop: "0.35rem" }}>
        {filename ? `Cargado: ${filename}` : "Arrastra un CSV o haz clic"}
      </div>
      <input
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
