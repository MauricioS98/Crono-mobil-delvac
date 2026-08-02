import { useEffect, useMemo, useState } from "react";
import type { Pilot, StartOrderVsPair, TestPart } from "../types";
import { pilotArtCandidates } from "../overlays/redbull/pilotArt";

type Props = {
  eventId: string;
  testId: string;
  testName: string;
  part: TestPart;
  pilots: Pilot[];
  onSaved: (pairs: StartOrderVsPair[]) => void;
  save: (pairs: StartOrderVsPair[]) => Promise<void>;
};

function normalizeNum(n: string): string {
  return String(n || "")
    .replace(/^#/, "")
    .trim();
}

function MiniPilot({
  number,
  pilots,
}: {
  number: string;
  pilots: Pilot[];
}) {
  const n = normalizeNum(number);
  const pilot = pilots.find(
    (p) => normalizeNum(p.number).toUpperCase() === n.toUpperCase()
  );
  const name = pilot?.name || "";
  const candidates = pilotArtCandidates(n, name);
  const [idx, setIdx] = useState(0);
  const src = n && idx < candidates.length ? candidates[idx] : null;

  useEffect(() => {
    setIdx(0);
  }, [n, name]);

  if (!n) {
    return <span className="so-edit-preview muted">—</span>;
  }

  return (
    <span className="so-edit-preview">
      {src ? (
        <img
          src={src}
          alt={name || n}
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <span className="so-edit-preview-text">
          #{n} {name ? `· ${name}` : "· sin ficha / sin PNG"}
        </span>
      )}
    </span>
  );
}

export function StartOrderVsEditor({
  eventId,
  testId,
  testName,
  part,
  pilots,
  onSaved,
  save,
}: Props) {
  const [pairs, setPairs] = useState<StartOrderVsPair[]>(
    () => part.startOrderVs || []
  );
  const [draftA, setDraftA] = useState("");
  const [draftB, setDraftB] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setPairs(part.startOrderVs || []);
  }, [part.id, part.startOrderVs]);

  const overlayUrl = useMemo(() => {
    const q = new URLSearchParams({
      test: testId,
      part: part.id,
    });
    return `/overlay/${eventId}/orden-salida?${q}`;
  }, [eventId, testId, part.id]);

  const persist = async (next: StartOrderVsPair[]) => {
    setBusy(true);
    setErr("");
    try {
      await save(next);
      setPairs(next);
      onSaved(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const addPair = async () => {
    const a = normalizeNum(draftA);
    const b = normalizeNum(draftB);
    if (!a || !b) {
      setErr("Escribe el número de ambos pilotos");
      return;
    }
    const next = [...pairs, { a, b }];
    setDraftA("");
    setDraftB("");
    await persist(next);
  };

  const removeAt = async (index: number) => {
    const next = pairs.filter((_, i) => i !== index);
    await persist(next);
  };

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= pairs.length) return;
    const next = [...pairs];
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    await persist(next);
  };

  return (
    <div className="so-editor">
      <div className="so-editor-head">
        <div>
          <p className="so-editor-title">Orden de salida (VS)</p>
          <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
            Enfrentamientos 1 vs 1 para {testName} — {part.name}. Escribe el N° del
            piloto; se muestra el PNG si existe.
          </p>
        </div>
        <a className="btn btn-secondary btn-sm" href={overlayUrl} target="_blank" rel="noreferrer">
          Abrir overlay VS
        </a>
      </div>

      {err && <div className="alert alert-error">{err}</div>}

      <div className="so-editor-add">
        <input
          inputMode="numeric"
          placeholder="N° piloto A"
          value={draftA}
          onChange={(e) => setDraftA(e.target.value)}
          disabled={busy}
        />
        <span className="so-editor-vs">VS</span>
        <input
          inputMode="numeric"
          placeholder="N° piloto B"
          value={draftB}
          onChange={(e) => setDraftB(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-primary btn-sm" type="button" onClick={addPair} disabled={busy}>
          Agregar VS
        </button>
      </div>

      <div className="so-editor-draft-preview">
        <MiniPilot number={draftA} pilots={pilots} />
        <span className="muted">vs</span>
        <MiniPilot number={draftB} pilots={pilots} />
      </div>

      {pairs.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Aún no hay enfrentamientos en esta salida.
        </p>
      ) : (
        <ul className="so-editor-list">
          {pairs.map((p, i) => (
            <li key={`${p.a}-${p.b}-${i}`} className="so-editor-item">
              <span className="so-editor-order">{i + 1}</span>
              <MiniPilot number={p.a} pilots={pilots} />
              <span className="so-editor-vs">VS</span>
              <MiniPilot number={p.b} pilots={pilots} />
              <div className="so-editor-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy || i === pairs.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => removeAt(i)}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
