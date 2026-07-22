import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Event } from "../types";

export function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setEvents(await api.listEvents());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const ev = await api.createEvent({ name, date, location });
      setName("");
      setDate("");
      setLocation("");
      navigate(`/eventos/${ev.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`¿Eliminar el evento "${label}"?`)) return;
    await api.deleteEvent(id);
    load();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Eventos</h1>
          <p>Crea el evento del Gran Premio y gestiona sus pruebas de cronometraje.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div className="grid grid-2">
        <form className="card form" onSubmit={create}>
          <h3>Nuevo evento</h3>
          <div className="field">
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gran Premio Mobil Delvac 2026" required />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Lugar</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Autódromo..." />
          </div>
          <button className="btn btn-primary" disabled={creating}>
            {creating ? "Creando…" : "Crear evento"}
          </button>
        </form>

        <div className="stack">
          {events.length === 0 && <div className="empty">Aún no hay eventos. Crea el primero.</div>}
          {events.map((ev) => (
            <div key={ev.id} className="card" style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
              <Link to={`/eventos/${ev.id}`} className="card-link" style={{ flex: 1, border: "none", boxShadow: "none", padding: 0, background: "none" }}>
                <h3>{ev.name}</h3>
                <div className="meta">
                  {ev.date && <span>{ev.date}</span>}
                  {ev.location && <span>{ev.location}</span>}
                  <span className="chip">{ev.tests.length} pruebas</span>
                  <span className="chip">{ev.timingPoints.length} puntos</span>
                </div>
              </Link>
              <button className="btn btn-danger btn-sm" onClick={() => remove(ev.id, ev.name)}>
                Eliminar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
