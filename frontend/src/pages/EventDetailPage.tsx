import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatOffsetInput } from "../api";
import type { Event, ResultRow, Test, TestPart, TimingPoint } from "../types";
import { EventPilotsSection } from "./EventPilotsSection";

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
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>({});
  const [partByTest, setPartByTest] = useState<Record<string, string | null>>({});
  const [resultsByTest, setResultsByTest] = useState<
    Record<string, { rows: ResultRow[]; title: string; warning: string; partId?: string }>
  >({});
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
    setPartByTest((prev) => {
      const next = { ...prev };
      for (const t of ev.tests) {
        if (next[t.id] == null && t.parts[0]) next[t.id] = t.parts[0].id;
      }
      return next;
    });
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  const toggleTest = (testId: string) => {
    setExpandedTests((prev) => ({ ...prev, [testId]: !prev[testId] }));
  };

  const refreshResults = async (testId: string, partId?: string | null) => {
    if (!event) return;
    const pid = partId || undefined;
    setError("");
    try {
      const data = await api.getResults(event.id, testId, {
        from: fromId,
        to: toId,
        partId: pid,
      });
      setResultsByTest((prev) => ({
        ...prev,
        [testId]: {
          rows: data.rows,
          title: data.title,
          warning: data.warning || "",
          partId: pid,
        },
      }));
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
    setExpandedTests((prev) => ({ ...prev, [t.id]: true }));
  };

  const addPart = async (testId: string) => {
    const test = event.tests.find((t) => t.id === testId);
    const name = prompt("Nombre de la parte / salida", `Salida ${(test?.parts.length || 0) + 1}`);
    if (!name) return;
    const p = (await api.createPart(event.id, testId, { name, combinedMode: false })) as TestPart;
    await load();
    setPartByTest((prev) => ({ ...prev, [testId]: p.id }));
    setExpandedTests((prev) => ({ ...prev, [testId]: true }));
  };

  const uploadCsv = async (testId: string, part: TestPart, timingPointId: string, file: File) => {
    setError("");
    try {
      const res = await api.uploadCsv(
        event.id,
        testId,
        part.id,
        file,
        timingPointId,
        part.combinedMode
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

      <EventPilotsSection eventId={event.id} pilots={event.pilots || []} onChange={load} />

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
          <div className="accordion">
            {event.tests.map((test) => {
              const open = Boolean(expandedTests[test.id]);
              const selectedPartId = partByTest[test.id] ?? test.parts[0]?.id ?? null;
              const selectedPart = test.parts.find((p) => p.id === selectedPartId);
              const testResults = resultsByTest[test.id];

              return (
                <div key={test.id} className={`accordion-item ${open ? "open" : ""}`}>
                  <button
                    type="button"
                    className="accordion-trigger"
                    onClick={() => toggleTest(test.id)}
                  >
                    <div className="accordion-trigger-main">
                      <strong>{test.name}</strong>
                      <span className="muted">
                        {test.parts.length} parte(s)
                        {!open && test.description
                          ? ` · ${test.description.slice(0, 60)}${test.description.length > 60 ? "…" : ""}`
                          : ""}
                      </span>
                    </div>
                    <span className="accordion-chevron" aria-hidden>
                      ▾
                    </span>
                  </button>

                  {open && (
                    <div className="accordion-body test-detail">
                      <div className="test-toolbar">
                        <button className="btn btn-secondary btn-sm" onClick={() => addPart(test.id)}>
                          + Parte / salida
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={async () => {
                            if (!confirm("¿Eliminar prueba?")) return;
                            await api.deleteTest(event.id, test.id);
                            setExpandedTests((prev) => {
                              const next = { ...prev };
                              delete next[test.id];
                              return next;
                            });
                            load();
                          }}
                        >
                          Eliminar prueba
                        </button>
                      </div>

                      <section className="test-block">
                        <header className="test-block-head">
                          <h4>Descripción</h4>
                        </header>
                        <div className="field">
                          <textarea
                            rows={2}
                            value={test.description || ""}
                            placeholder="Notas de la prueba, condiciones, observaciones…"
                            onChange={(e) => {
                              const description = e.target.value;
                              setEvent({
                                ...event,
                                tests: event.tests.map((t) =>
                                  t.id === test.id ? { ...t, description } : t
                                ),
                              });
                            }}
                          />
                        </div>
                        <div className="test-block-footer">
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={Boolean(test.showDescriptionInPdf)}
                              onChange={(e) => {
                                const showDescriptionInPdf = e.target.checked;
                                setEvent({
                                  ...event,
                                  tests: event.tests.map((t) =>
                                    t.id === test.id ? { ...t, showDescriptionInPdf } : t
                                  ),
                                });
                              }}
                            />
                            Mostrar en el PDF
                          </label>
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            onClick={async () => {
                              await api.updateTest(event.id, test.id, {
                                description: test.description || "",
                                showDescriptionInPdf: Boolean(test.showDescriptionInPdf),
                              });
                              setMsg("Datos de la prueba guardados");
                              load();
                            }}
                          >
                            Guardar
                          </button>
                        </div>
                      </section>

                      <section className="test-block">
                        <header className="test-block-head">
                          <h4>Salidas / CSV</h4>
                          {selectedPart && (
                            <span className="chip">
                              {selectedPart.combinedMode ? "CSV combinado" : "CSV por punto"}
                            </span>
                          )}
                        </header>

                        {test.parts.length === 0 ? (
                          <div className="empty empty-sm">Agrega una parte (salida) para cargar CSV.</div>
                        ) : (
                          <>
                            <div className="part-tabs">
                              {test.parts.map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  className={`part-tab ${selectedPartId === p.id ? "active" : ""}`}
                                  onClick={() =>
                                    setPartByTest((prev) => ({ ...prev, [test.id]: p.id }))
                                  }
                                >
                                  {p.name}
                                  {p.combinedMode ? " · comb." : ""}
                                </button>
                              ))}
                            </div>

                            {selectedPart && (
                              <div className="stack" style={{ gap: "0.85rem" }}>
                                <div className="test-toolbar test-toolbar-subtle">
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={async () => {
                                      await api.updatePart(event.id, test.id, selectedPart.id, {
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
                                      await api.deletePart(event.id, test.id, selectedPart.id);
                                      setPartByTest((prev) => ({ ...prev, [test.id]: null }));
                                      load();
                                    }}
                                  >
                                    Eliminar parte
                                  </button>
                                </div>

                                {selectedPart.combinedMode ? (
                                  <CsvDrop
                                    label="CSV único"
                                    hint="Tiempo de vuelta ≠ 0 = tiempo de carrera"
                                    filename={selectedPart.csvs[0]?.filename}
                                    onFile={(f) =>
                                      uploadCsv(
                                        test.id,
                                        selectedPart,
                                        points[0]?.id || "combined",
                                        f
                                      )
                                    }
                                  />
                                ) : (
                                  <div className="csv-grid">
                                    {points.map((p) => {
                                      const slot = selectedPart.csvs.find(
                                        (c) => c.timingPointId === p.id
                                      );
                                      return (
                                        <CsvDrop
                                          key={p.id}
                                          label={p.name}
                                          hint="Arrastra un CSV o haz clic"
                                          filename={slot?.filename}
                                          onFile={(f) =>
                                            uploadCsv(test.id, selectedPart, p.id, f)
                                          }
                                        />
                                      );
                                    })}
                                  </div>
                                )}

                                <button
                                  className="btn btn-secondary"
                                  onClick={() => refreshResults(test.id, selectedPart.id)}
                                >
                                  Calcular resultado parcial
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </section>

                      <section className="test-block test-block-results">
                        <header className="test-block-head">
                          <h4>Resultados</h4>
                        </header>

                        <div className="results-controls">
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
                          <button
                            className="btn btn-primary results-run-btn"
                            onClick={() => refreshResults(test.id, null)}
                          >
                            Unificado (mejor tiempo)
                          </button>
                        </div>

                        {testResults?.title && (
                          <p className="results-title">{testResults.title}</p>
                        )}
                        {testResults?.warning && (
                          <div className="alert alert-error">{testResults.warning}</div>
                        )}

                        {testResults?.title &&
                          testResults.rows.length === 0 &&
                          !testResults.warning && (
                            <div className="empty empty-sm">Sin resultados para mostrar.</div>
                          )}

                        {testResults && testResults.rows.length > 0 && (
                          <>
                            <div className="export-row">
                              {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
                                <a
                                  key={fmt}
                                  className="btn btn-ghost btn-sm"
                                  href={api.exportUrl(event.id, test.id, fmt, {
                                    from: fromId,
                                    to: toId,
                                    partId: testResults.partId,
                                  })}
                                >
                                  {fmt.toUpperCase()}
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
                                  {testResults.rows.map((r) => (
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
                      </section>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CsvDrop({
  label,
  hint,
  filename,
  onFile,
}: {
  label: string;
  hint?: string;
  filename?: string;
  onFile: (f: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  const loaded = Boolean(filename);
  return (
    <label
      className={`csv-slot ${loaded ? "loaded" : ""} ${drag ? "drag" : ""}`}
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
      <span className="csv-slot-label">{label}</span>
      {loaded ? (
        <span className="csv-slot-file" title={filename}>
          {filename}
        </span>
      ) : (
        <span className="csv-slot-hint">{hint || "Arrastra un CSV o haz clic"}</span>
      )}
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}
