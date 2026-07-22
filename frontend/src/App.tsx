import { NavLink, Route, Routes } from "react-router-dom";
import { EventsPage } from "./pages/EventsPage";
import { EventDetailPage } from "./pages/EventDetailPage";

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
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/eventos/:id" element={<EventDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}
