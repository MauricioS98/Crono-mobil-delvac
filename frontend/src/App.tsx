import { NavLink, Route, Routes } from "react-router-dom";
import { EventsPage } from "./pages/EventsPage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { PilotsPage } from "./pages/PilotsPage";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">GPMD</span>
          <span className="brand-sub">Cronometraje</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Eventos
          </NavLink>
          <NavLink to="/pilotos">Pilotos</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/eventos/:id" element={<EventDetailPage />} />
          <Route path="/pilotos" element={<PilotsPage />} />
        </Routes>
      </main>
    </div>
  );
}
