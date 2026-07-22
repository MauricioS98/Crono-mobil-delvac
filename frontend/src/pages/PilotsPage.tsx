import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Pilot } from "../types";

const empty: Omit<Pilot, "id"> = { number: "", name: "", category: "", league: "", notes: "" };

const MAP_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "number", label: "Nº", required: true },
  { key: "firstName", label: "Nombre" },
  { key: "lastName", label: "Apellido/s" },
  { key: "category", label: "Clase" },
  { key: "league", label: "Liga" },
  { key: "moto", label: "Moto" },
  { key: "club", label: "Club" },
  { key: "doc", label: "Doc/EPS" },
  { key: "phone", label: "Cel/Email" },
];

type Preview = {
  filename: string;
  columns: { index: number; label: string; header: string }[];
  headerOrder: string;
  sampleRows: string[][];
  suggestedMapping: Record<string, number>;
  totalDataRows: number;
};

export function PilotsPage() {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [drag, setDrag] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({});
  const [skipFirstRow, setSkipFirstRow] = useState(true);

  const load = async () => {
    setPilots(await api.listPilots());
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editing) {
        await api.updatePilot(editing, form);
      } else {
        await api.createPilot(form);
      }
      setForm(empty);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    }
  };

  const edit = (p: Pilot) => {
    setEditing(p.id);
    setForm({ number: p.number, name: p.name, category: p.category, league: p.league, notes: p.notes || "" });
  };

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar piloto?")) return;
    await api.deletePilot(id);
    load();
  };

  const openImportAssistant = async (file: File) => {
    setError("");
    setMsg("");
    setLoadingPreview(true);
    try {
      const data = await api.previewPilotsImport(file);
      setPendingFile(file);
      setPreview(data);
      setMapping({ ...data.suggestedMapping });
      setSkipFirstRow(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al leer CSV");
    } finally {
      setLoadingPreview(false);
    }
  };

  const closeAssistant = () => {
    setPendingFile(null);
    setPreview(null);
    setMapping({});
  };

  const confirmImport = async () => {
    if (!pendingFile) return;
    if (mapping.number == null) {
      setError("Debes seleccionar la columna para Nº");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const res = await api.importPilots(pendingFile, mapping, skipFirstRow);
      setPilots(res.pilots);
      setMsg(
        `Importado ${res.summary.filename}: ${res.summary.added} nuevos, ${res.summary.updated} actualizados` +
          (res.summary.skipped ? `, ${res.summary.skipped} omitidos` : "")
      );
      closeAssistant();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const mappedPreview = useMemo(() => {
    if (!preview) return [];
    return preview.sampleRows.slice(0, 4).map((row) => {
      const first = mapping.firstName != null ? row[mapping.firstName] || "" : "";
      const last = mapping.lastName != null ? row[mapping.lastName] || "" : "";
      return {
        number: mapping.number != null ? row[mapping.number] || "" : "",
        name: [first, last].filter(Boolean).join(" "),
        category: mapping.category != null ? row[mapping.category] || "" : "",
        league: mapping.league != null ? row[mapping.league] || "" : "",
      };
    });
  }, [preview, mapping]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Base de pilotos</h1>
          <p>Categoría, liga y datos que se consultan al generar resultados.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}
      {msg && <div className="alert" style={{ marginBottom: "1rem" }}>{msg}</div>}

      <div className="card" style={{ marginBottom: "1rem", padding: "0.85rem" }}>
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
            if (f) openImportAssistant(f);
          }}
        >
          <strong>{loadingPreview ? "Leyendo archivo…" : "Importar CSV de pilotos"}</strong>
          <div style={{ marginTop: "0.35rem" }}>
            Al cargar el archivo podrás indicar qué columna corresponde a cada campo.
          </div>
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            disabled={loadingPreview || importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openImportAssistant(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="grid grid-2">
        <form className="card form" onSubmit={submit}>
          <h3>{editing ? "Editar piloto" : "Agregar piloto"}</h3>
          <div className="field">
            <label>N°</label>
            <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="#111" required />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Categoría</label>
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="125cc Junior" />
          </div>
          <div className="field">
            <label>Liga</label>
            <input value={form.league} onChange={(e) => setForm({ ...form, league: e.target.value })} />
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
          <div className="actions">
            <button className="btn btn-primary">{editing ? "Guardar" : "Agregar"}</button>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setForm(empty); }}>
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Liga</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pilots.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center" }}>
                    Sin pilotos registrados
                  </td>
                </tr>
              )}
              {pilots.map((p) => (
                <tr key={p.id}>
                  <td>{p.number}</td>
                  <td>{p.name}</td>
                  <td>{p.category || "—"}</td>
                  <td>{p.league || "—"}</td>
                  <td>
                    <div className="row-inline">
                      <button className="btn btn-ghost btn-sm" onClick={() => edit(p)}>Editar</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>×</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && pendingFile && (
        <div className="modal-backdrop" onClick={closeAssistant}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Asistente de importación</h2>
            <p className="muted" style={{ margin: 0 }}>
              {preview.filename} · {preview.totalDataRows} filas de datos detectadas
            </p>

            <p style={{ margin: "1rem 0 0.35rem", fontSize: "0.85rem", fontWeight: 600 }}>
              Orden de columnas en el archivo:
            </p>
            <div className="header-order">{preview.headerOrder}</div>

            <p style={{ margin: "1.1rem 0 0", fontWeight: 600 }}>Seleccionar ajuste de columna:</p>
            <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              El nombre del encabezado no importa: elige qué columna del documento va en cada campo.
            </p>

            <div className="map-grid">
              {MAP_FIELDS.map((field) => (
                <div className="map-field" key={field.key}>
                  <label>
                    {field.label}
                    {field.required ? " *" : ""}
                  </label>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMapping((m) => ({
                        ...m,
                        [field.key]: v === "" ? undefined : Number(v),
                      }));
                    }}
                  >
                    <option value="">Ninguno</option>
                    {preview.columns.map((col) => (
                      <option key={col.index} value={col.index}>
                        {col.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={skipFirstRow}
                onChange={(e) => setSkipFirstRow(e.target.checked)}
              />
              Saltar primera fila (encabezados)
            </label>

            {mappedPreview.length > 0 && (
              <>
                <p style={{ margin: "1rem 0 0.4rem", fontSize: "0.85rem", fontWeight: 600 }}>
                  Vista previa con el mapeo actual:
                </p>
                <div className="preview-mini">
                  <table>
                    <thead>
                      <tr>
                        <th>Nº</th>
                        <th>Nombre</th>
                        <th>Clase</th>
                        <th>Liga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappedPreview.map((r, i) => (
                        <tr key={i}>
                          <td>{r.number || "—"}</td>
                          <td>{r.name || "—"}</td>
                          <td>{r.category || "—"}</td>
                          <td>{r.league || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={closeAssistant} disabled={importing}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmImport} disabled={importing}>
                {importing ? "Importando…" : "Importar pilotos"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
