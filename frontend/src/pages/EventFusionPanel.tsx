import { useEffect, useState } from "react";
import { api } from "../api";
import type { FusionRow, SavedFusion, Test, TimingPoint } from "../types";

interface EventFusionPanelProps {
  eventId: string;
  tests: Test[];
  points: TimingPoint[];
  fusions: SavedFusion[];
  onReload: () => void | Promise<void>;
}

type FusionTestMeta = { id: string; name: string; segmentLabel: string };
type Tab = "new" | "saved";

function segmentLabel(test: Test, points: TimingPoint[]): string {
  const fromName = points.find((p) => p.id === test.fromPointId)?.name ?? points[0]?.name ?? "Desde";
  const toName =
    points.find((p) => p.id === test.toPointId)?.name ?? points[1]?.name ?? "Hasta";
  return `${fromName} → ${toName}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function FusionResultsTable({
  rows,
  fusionTests,
}: {
  rows: FusionRow[];
  fusionTests: FusionTestMeta[];
}) {
  return (
    <div className="table-wrap fusion-table-wrap">
      <table className="results-table fusion-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>N°</th>
            <th>Nombre</th>
            {fusionTests.map((t) => (
              <th key={t.id} className="fusion-col-test">
                <span>{t.name}</span>
                <span className="fusion-col-segment">{t.segmentLabel}</span>
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number}>
              <td className={r.position <= 3 ? `pos-${r.position}` : ""}>{r.position}</td>
              <td>{r.number}</td>
              <td>{r.name || "—"}</td>
              {r.byTest.map((t) => (
                <td key={t.testId} className="time">
                  {t.timeFormatted}
                </td>
              ))}
              <td className="time fusion-total">{r.totalTimeFormatted}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportButtons({
  hrefFor,
}: {
  hrefFor: (format: "csv" | "xlsx" | "pdf") => string;
}) {
  return (
    <div className="export-row fusion-export-row">
      {(["csv", "xlsx", "pdf"] as const).map((fmt) => (
        <a key={fmt} className="btn btn-ghost btn-sm" href={hrefFor(fmt)}>
          {fmt.toUpperCase()}
        </a>
      ))}
    </div>
  );
}

export function EventFusionPanel({
  eventId,
  tests,
  points,
  fusions,
  onReload,
}: EventFusionPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [title, setTitle] = useState("");
  const [saveName, setSaveName] = useState("");
  const [rows, setRows] = useState<FusionRow[]>([]);
  const [fusionTests, setFusionTests] = useState<FusionTestMeta[]>([]);
  const [warning, setWarning] = useState("");
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);

  const activeSaved = fusions.find((f) => f.id === activeSavedId) || null;
  const savedCount = fusions.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (tab === "saved" && fusions.length > 0 && !activeSavedId) {
      setActiveSavedId(fusions[0].id);
    }
  }, [tab, fusions, activeSavedId]);

  const toggleTest = (testId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) next.delete(testId);
      else next.add(testId);
      return next;
    });
  };

  const runFusion = async () => {
    const ids = [...selected];
    if (ids.length < 2) {
      setError("Selecciona al menos 2 pruebas.");
      return;
    }
    setLoading(true);
    setError("");
    setMsg("");
    setActiveSavedId(null);
    try {
      const data = await api.getFusion(eventId, ids);
      setTitle(data.title);
      setRows(data.rows);
      setFusionTests(data.tests);
      setWarning(data.warning || "");
      if (!saveName.trim()) {
        setSaveName(data.title.replace(/^Fusión —\s*/, ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al fusionar");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const saveFusion = async () => {
    const name = saveName.trim();
    const ids = [...selected];
    if (!name) {
      setError("Indica un nombre para guardar la fusión.");
      return;
    }
    if (ids.length < 2 || rows.length === 0) {
      setError("Calcula una fusión antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const saved = await api.saveFusion(eventId, name, ids);
      setMsg(`Fusión «${saved.name}» guardada.`);
      await onReload();
      setTab("saved");
      setActiveSavedId(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const deleteFusion = async (fusionId: string) => {
    if (!window.confirm("¿Eliminar esta fusión guardada?")) return;
    setDeletingId(fusionId);
    setError("");
    try {
      await api.deleteFusion(eventId, fusionId);
      if (activeSavedId === fusionId) setActiveSavedId(null);
      await onReload();
      setMsg("Fusión eliminada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al eliminar");
    } finally {
      setDeletingId(null);
    }
  };

  const viewSaved = (fusion: SavedFusion) => {
    setActiveSavedId(fusion.id);
    setTab("saved");
    setError("");
    setMsg("");
  };

  const displayRows = tab === "saved" && activeSaved ? activeSaved.rows : rows;
  const displayTests = tab === "saved" && activeSaved ? activeSaved.tests : fusionTests;
  const displayTitle =
    tab === "saved" && activeSaved ? activeSaved.name : title || "Resultado de fusión";
  const displayWarning =
    tab === "saved" && activeSaved ? activeSaved.warning || "" : warning;

  const liveTestIds = [...selected];
  const canExportLive = tab === "new" && rows.length > 0 && liveTestIds.length >= 2;

  return (
    <>
      <button
        type="button"
        className="fusion-fab"
        onClick={() => setOpen(true)}
        title="Fusión de tiempos entre pruebas"
      >
        Fusión
        {savedCount > 0 && <span className="fusion-fab-badge">{savedCount}</span>}
      </button>

      {open && (
        <div className="fusion-backdrop" onClick={() => setOpen(false)} role="presentation" />
      )}

      <aside className={`fusion-panel ${open ? "open" : ""}`} aria-hidden={!open}>
        <header className="fusion-panel-head">
          <div>
            <h3>Fusión de pruebas</h3>
            <p className="fusion-panel-sub">Combina tiempos unificados de varias pruebas</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm fusion-close"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </header>

        <nav className="fusion-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`fusion-tab ${tab === "new" ? "active" : ""}`}
            onClick={() => setTab("new")}
          >
            Nueva fusión
          </button>
          <button
            type="button"
            role="tab"
            className={`fusion-tab ${tab === "saved" ? "active" : ""}`}
            onClick={() => setTab("saved")}
          >
            Guardadas
            {savedCount > 0 && <span className="fusion-tab-count">{savedCount}</span>}
          </button>
        </nav>

        <div className="fusion-panel-body">
          {tab === "new" && (
            <>
              <p className="muted fusion-panel-desc">
                Suma el <strong>resultado unificado</strong> de cada prueba usando el segmento{" "}
                <strong>Desde/Hasta</strong> configurado en cada una.
              </p>

              {tests.length < 2 ? (
                <p className="muted">Necesitas al menos 2 pruebas en el evento.</p>
              ) : (
                <>
                  <div className="fusion-card">
                    <p className="fusion-card-label">Pruebas a fusionar</p>
                    <div className="fusion-test-list">
                      {tests.map((t) => (
                        <label key={t.id} className="fusion-test-item">
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggleTest(t.id)}
                          />
                          <span className="fusion-test-item-main">
                            <span>{t.name}</span>
                            <span className="muted fusion-test-segment">
                              {segmentLabel(t, points)}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary fusion-calc-btn"
                    disabled={loading || selected.size < 2}
                    onClick={runFusion}
                  >
                    {loading ? "Calculando…" : "Calcular fusión"}
                  </button>

                  {rows.length === 0 && !loading && !error && selected.size >= 2 && (
                    <p className="muted fusion-hint">
                      Pulsa «Calcular fusión» para ver la clasificación.
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {tab === "saved" && (
            <>
              {savedCount === 0 ? (
                <p className="muted fusion-empty-saved">
                  Aún no hay fusiones guardadas. Calcula una en «Nueva fusión» y guárdala con un
                  nombre.
                </p>
              ) : (
                <div className="fusion-saved-list">
                  {fusions.map((f) => (
                    <div
                      key={f.id}
                      className={`fusion-saved-item ${activeSavedId === f.id ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="fusion-saved-item-btn"
                        onClick={() => viewSaved(f)}
                      >
                        <strong>{f.name}</strong>
                        <span className="muted">
                          {f.tests.map((t) => t.name).join(" + ")} · {f.rows.length} pilotos
                        </span>
                        <span className="muted fusion-saved-date">{formatDate(f.createdAt)}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm fusion-saved-delete"
                        title="Eliminar"
                        disabled={deletingId === f.id}
                        onClick={() => deleteFusion(f.id)}
                      >
                        {deletingId === f.id ? "…" : "✕"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {error && <div className="alert alert-error">{error}</div>}
          {msg && <div className="alert alert-info">{msg}</div>}

          {displayRows.length > 0 && (
            <div className="fusion-results">
              <div className="fusion-results-head">
                <div>
                  <p className="fusion-results-title">{displayTitle}</p>
                  {displayWarning && (
                    <p className="fusion-results-warning">{displayWarning}</p>
                  )}
                </div>
                {tab === "saved" && activeSaved ? (
                  <ExportButtons
                    hrefFor={(fmt) => api.fusionExportUrl(eventId, activeSaved.id, fmt)}
                  />
                ) : canExportLive ? (
                  <ExportButtons
                    hrefFor={(fmt) =>
                      api.fusionLiveExportUrl(
                        eventId,
                        fmt,
                        liveTestIds,
                        saveName.trim() || undefined
                      )
                    }
                  />
                ) : null}
              </div>

              {tab === "new" && rows.length > 0 && (
                <div className="fusion-save-card">
                  <p className="fusion-card-label">Guardar fusión</p>
                  <div className="fusion-save-row">
                    <input
                      type="text"
                      className="fusion-name-input"
                      placeholder="Nombre de la fusión"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving || !saveName.trim()}
                      onClick={saveFusion}
                    >
                      {saving ? "Guardando…" : "Guardar fusión"}
                    </button>
                  </div>
                </div>
              )}

              <FusionResultsTable rows={displayRows} fusionTests={displayTests} />

              <p className="muted fusion-footnote">
                Clasificación por tiempo total acumulado (menor es mejor).
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
