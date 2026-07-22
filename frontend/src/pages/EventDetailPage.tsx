import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatOffsetInput, formatPenaltyInput, parseOffsetToMs } from "../api";
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
    Record<
      string,
      {
        rows: ResultRow[];
        title: string;
        warning: string;
        diffNote?: string;
        partId?: string;
        scope: string;
      }
    >
  >({});
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});
  const [penaltyDrafts, setPenaltyDrafts] = useState<
    Record<string, { timePenalty: string; positionPenalty: string; comment: string }>
  >({});
  const [savingPenalty, setSavingPenalty] = useState<string | null>(null);

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
          diffNote: data.diffNote || "",
          partId: pid,
          scope: data.scope,
        },
      }));
      const drafts: Record<string, { timePenalty: string; positionPenalty: string; comment: string }> =
        {};
      for (const r of data.rows) {
        const key = `${testId}:${r.number}`;
        drafts[key] = {
          timePenalty: formatPenaltyInput(r.timePenaltyMs),
          positionPenalty: r.positionPenalty ? String(r.positionPenalty) : "",
          comment: r.comment || "",
        };
      }
      setPenaltyDrafts((prev) => ({ ...prev, ...drafts }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al calcular resultados");
    }
  };

  const saveRowPenalty = async (testId: string, scope: string, number: string) => {
    if (!event) return;
    const key = `${testId}:${number}`;
    const draft = penaltyDrafts[key] || { timePenalty: "", positionPenalty: "", comment: "" };
    setSavingPenalty(key);
    setError("");
    try {
      await api.savePenalty(event.id, testId, {
        number,
        scope,
        timePenalty: draft.timePenalty || "0",
        positionPenalty: Number(draft.positionPenalty || 0),
        comment: draft.comment,
      });
      const current = resultsByTest[testId];
      await refreshResults(testId, current?.partId ?? null);
      setMsg(`Penalización guardada para #${number}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar penalización");
    } finally {
      setSavingPenalty(null);
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

      <div className="setup-layout">
        <form className="setup-panel form" onSubmit={saveMeta}>
          <header className="setup-panel-head">
            <h3>Datos del evento</h3>
            <p>Identidad del evento e imagen para exportaciones PDF.</p>
          </header>

          <div className="field">
            <label>Nombre</label>
            <input name="name" defaultValue={event.name} required />
          </div>
          <div className="setup-inline-2">
            <div className="field">
              <label>Fecha</label>
              <input name="date" type="date" defaultValue={event.date} />
            </div>
            <div className="field">
              <label>Lugar</label>
              <input name="location" defaultValue={event.location} />
            </div>
          </div>
          <div className="field">
            <label>Texto pie de página (PDF)</label>
            <input name="footerText" defaultValue={event.footerText} />
          </div>

          <div className="field">
            <label>Imagen de cabecera</label>
            <label className="header-upload">
              <span className="header-upload-btn">Seleccionar imagen</span>
              <span className="muted">PNG, JPG o WebP · se usa en todo el evento</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onHeader(e.target.files?.[0] || null)}
              />
            </label>
            {event.headerImage && (
              <div className="header-preview-wrap">
                <img
                  className="header-preview"
                  src={`/uploads/headers/${event.headerImage}?t=${event.updatedAt}`}
                  alt="Cabecera"
                />
              </div>
            )}
          </div>

          <button className="btn btn-primary">Guardar datos</button>
        </form>

        <div className="setup-panel">
          <header className="setup-panel-head">
            <div>
              <h3>Puntos de cronometraje</h3>
              <p>
                PC A es la referencia (desfase 0). Los demás van relativos a A · formato{" "}
                <code>hh:mm:ss.xxx</code>
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" type="button" onClick={addPoint}>
              + Punto
            </button>
          </header>

          <div className="timing-list">
            {points.map((p, i) => (
              <div key={p.id} className={`timing-card ${i === 0 ? "is-ref" : ""}`}>
                <div className="timing-card-badge">{i === 0 ? "Ref" : String.fromCharCode(65 + i)}</div>
                <div className="timing-point-row">
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
              </div>
            ))}
          </div>

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
              const showLapsCol =
                testResults?.rows.some((r) => r.laps != null && r.laps > 0) ?? false;

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
                              {selectedPart.combinedMode
                                ? selectedPart.combinedScoring === "laps"
                                  ? "CSV único · vueltas"
                                  : "CSV único · tiempo"
                                : "CSV por punto"}
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
                                  {p.combinedMode
                                    ? p.combinedScoring === "laps"
                                      ? " · vueltas"
                                      : " · tiempo"
                                    : ""}
                                </button>
                              ))}
                            </div>

                            {selectedPart && (
                              <div className="stack" style={{ gap: "0.85rem" }}>
                                <div className="test-toolbar test-toolbar-subtle">
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={async () => {
                                      if (selectedPart.combinedMode) {
                                        await api.updatePart(event.id, test.id, selectedPart.id, {
                                          combinedMode: false,
                                        });
                                      } else {
                                        await api.updatePart(event.id, test.id, selectedPart.id, {
                                          combinedMode: true,
                                          combinedScoring: "time",
                                          expectedLaps: null,
                                        });
                                      }
                                      load();
                                    }}
                                  >
                                    {selectedPart.combinedMode
                                      ? "Cambiar a CSV por punto"
                                      : "Cambiar a CSV único"}
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

                                {selectedPart.combinedMode && (
                                  <div className="combined-settings">
                                    <p className="combined-settings-title">Puntuación CSV único</p>
                                    <div className="combined-settings-row">
                                      <label className="combined-option">
                                        <input
                                          type="radio"
                                          name={`scoring-${selectedPart.id}`}
                                          checked={selectedPart.combinedScoring !== "laps"}
                                          onChange={async () => {
                                            await api.updatePart(event.id, test.id, selectedPart.id, {
                                              combinedScoring: "time",
                                              expectedLaps: null,
                                            });
                                            load();
                                          }}
                                        />
                                        Por tiempo
                                      </label>
                                      <label className="combined-option">
                                        <input
                                          type="radio"
                                          name={`scoring-${selectedPart.id}`}
                                          checked={selectedPart.combinedScoring === "laps"}
                                          onChange={async () => {
                                            await api.updatePart(event.id, test.id, selectedPart.id, {
                                              combinedScoring: "laps",
                                              expectedLaps: selectedPart.expectedLaps ?? null,
                                            });
                                            load();
                                          }}
                                        />
                                        Por vueltas
                                      </label>
                                    </div>
                                    {selectedPart.combinedScoring === "laps" && (
                                      <div className="combined-laps-config">
                                        <label className="combined-option">
                                          <input
                                            type="checkbox"
                                            checked={selectedPart.expectedLaps == null}
                                            onChange={async (e) => {
                                              await api.updatePart(event.id, test.id, selectedPart.id, {
                                                expectedLaps: e.target.checked ? null : 10,
                                              });
                                              load();
                                            }}
                                          />
                                          Vueltas indeterminadas
                                        </label>
                                        {selectedPart.expectedLaps != null && (
                                          <div className="field field-inline">
                                            <label>Vueltas esperadas</label>
                                            <input
                                              type="number"
                                              min={1}
                                              step={1}
                                              value={selectedPart.expectedLaps}
                                              onChange={async (e) => {
                                                const n = Number(e.target.value);
                                                if (n > 0) {
                                                  await api.updatePart(
                                                    event.id,
                                                    test.id,
                                                    selectedPart.id,
                                                    { expectedLaps: n }
                                                  );
                                                  load();
                                                }
                                              }}
                                            />
                                          </div>
                                        )}
                                        <p className="muted" style={{ fontSize: "0.78rem", margin: 0 }}>
                                          Gana quien complete más vueltas en menor tiempo.
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {selectedPart.combinedMode ? (
                                  <CsvDrop
                                    label="CSV único"
                                    hint={
                                      selectedPart.combinedScoring === "laps"
                                        ? "Usa columnas Vueltas y T° Transcurrido"
                                        : "Tiempo de vuelta ≠ 0 = tiempo de carrera"
                                    }
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
                                <p className="muted" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
                                  Si el CSV es acumulativo, solo se listan pilotos nuevos respecto a
                                  salidas anteriores.
                                </p>
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
                        {testResults?.diffNote && (
                          <div className="alert alert-info">{testResults.diffNote}</div>
                        )}

                        {testResults?.title &&
                          testResults.rows.length === 0 &&
                          !testResults.warning && (
                            <div className="empty empty-sm">
                              {testResults.diffNote || "Sin resultados para mostrar."}
                            </div>
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
                            <div className="table-wrap results-table-wrap">
                              <table className="results-table">
                                <thead>
                                  <tr>
                                    <th>Pos</th>
                                    <th>N°</th>
                                    <th>Nombre</th>
                                    <th>Categoría</th>
                                    <th>Liga</th>
                                    {showLapsCol && <th>Vueltas</th>}
                                    <th>Tiempo</th>
                                    <th>Salida</th>
                                    <th>Pen. tiempo</th>
                                    <th>Pen. pos</th>
                                    <th>Comentario</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {testResults.rows.map((r) => {
                                    const pKey = `${test.id}:${r.number}`;
                                    const draft = penaltyDrafts[pKey] || {
                                      timePenalty: "",
                                      positionPenalty: "",
                                      comment: "",
                                    };
                                    return (
                                      <tr
                                        key={`${r.number}-${r.partId || "u"}-${r.incomplete ? "inc" : "ok"}`}
                                        className={[
                                          r.hasPenalty ? "row-penalty" : "",
                                          r.incomplete ? "row-incomplete" : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" ")}
                                      >
                                        <td
                                          className={
                                            !r.incomplete && r.position <= 3 ? `pos-${r.position}` : ""
                                          }
                                        >
                                          {r.incomplete ? "—" : r.position}
                                        </td>
                                        <td>{r.number}</td>
                                        <td>
                                          {r.name || "—"}
                                          {r.missingPilot && (
                                            <span className="badge-warn"> · sin ficha</span>
                                          )}
                                        </td>
                                        <td>{r.category || "—"}</td>
                                        <td>{r.league || "—"}</td>
                                        {showLapsCol && (
                                          <td>
                                            {r.laps != null ? (
                                              <>
                                                {r.expectedLaps != null
                                                  ? `${r.laps} / ${r.expectedLaps}`
                                                  : r.laps}
                                                {r.lapsIncomplete && (
                                                  <span className="badge-warn"> · incompleto</span>
                                                )}
                                              </>
                                            ) : (
                                              "—"
                                            )}
                                          </td>
                                        )}
                                        <td className="time">
                                          {r.incomplete ? (
                                            <span className="badge-incomplete" title={r.statusLabel}>
                                              {r.statusLabel || "Incompleto"}
                                            </span>
                                          ) : (
                                            <>
                                              {r.timeFormatted}
                                              {r.timePenaltyMs > 0 && (
                                                <div className="muted" style={{ fontSize: "0.75rem" }}>
                                                  base {r.rawTimeFormatted}
                                                </div>
                                              )}
                                            </>
                                          )}
                                          {!r.incomplete && r.segmentLabel?.includes("(") && (
                                            <div className="muted" style={{ fontSize: "0.72rem" }}>
                                              {r.segmentLabel}
                                            </div>
                                          )}
                                        </td>
                                        <td>{r.partName || "—"}</td>
                                        <td>
                                          <div className="penalty-time-cell">
                                            <input
                                              className="penalty-input"
                                              placeholder="0:05.000"
                                              value={draft.timePenalty}
                                              onChange={(e) =>
                                                setPenaltyDrafts((prev) => ({
                                                  ...prev,
                                                  [pKey]: { ...draft, timePenalty: e.target.value },
                                                }))
                                              }
                                            />
                                            <button
                                              type="button"
                                              className="btn btn-secondary btn-sm penalty-adj"
                                              title="Restar 5 segundos"
                                              onClick={() => {
                                                const current = parseOffsetToMs(draft.timePenalty || "0");
                                                const next = Math.max(0, current - 5000);
                                                setPenaltyDrafts((prev) => ({
                                                  ...prev,
                                                  [pKey]: {
                                                    ...draft,
                                                    timePenalty: formatPenaltyInput(next),
                                                  },
                                                }));
                                              }}
                                            >
                                              −5
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-secondary btn-sm penalty-adj"
                                              title="Sumar 5 segundos"
                                              onClick={() => {
                                                const current = parseOffsetToMs(draft.timePenalty || "0");
                                                const next = Math.max(0, current) + 5000;
                                                setPenaltyDrafts((prev) => ({
                                                  ...prev,
                                                  [pKey]: {
                                                    ...draft,
                                                    timePenalty: formatPenaltyInput(next),
                                                  },
                                                }));
                                              }}
                                            >
                                              +5
                                            </button>
                                          </div>
                                        </td>
                                        <td>
                                          <input
                                            className="penalty-input penalty-input-sm"
                                            type="number"
                                            min={0}
                                            step={1}
                                            placeholder="0"
                                            value={draft.positionPenalty}
                                            onChange={(e) =>
                                              setPenaltyDrafts((prev) => ({
                                                ...prev,
                                                [pKey]: {
                                                  ...draft,
                                                  positionPenalty: e.target.value,
                                                },
                                              }))
                                            }
                                          />
                                        </td>
                                        <td>
                                          <input
                                            className="penalty-input penalty-input-wide"
                                            placeholder="Motivo…"
                                            value={draft.comment}
                                            onChange={(e) =>
                                              setPenaltyDrafts((prev) => ({
                                                ...prev,
                                                [pKey]: { ...draft, comment: e.target.value },
                                              }))
                                            }
                                          />
                                        </td>
                                        <td>
                                          <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            disabled={savingPenalty === pKey}
                                            onClick={() =>
                                              saveRowPenalty(test.id, testResults.scope, r.number)
                                            }
                                          >
                                            {savingPenalty === pKey ? "…" : "OK"}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                              Pen. tiempo: formato <code>m:ss.xxx</code> o <code>hh:mm:ss.xxx</code>{" "}
                              (atajos <strong>−5</strong> / <strong>+5</strong>). Pen. pos: posiciones a
                              sumar (+). Guarda con OK; el ranking se recalcula. Los tiempos incompletos
                              (solo salida o solo llegada) aparecen marcados aquí y no salen en el PDF
                              hasta tener ambos puntos.
                            </p>
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
