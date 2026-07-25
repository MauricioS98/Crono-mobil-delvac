import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";
import { HEADERS_DIR } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Archivos de cabeceras
app.use("/uploads/headers", express.static(HEADERS_DIR));

// API
app.use("/api", routes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "GPMD Cronometraje" });
});

// ---------- FRONTEND ----------
const frontendPath = path.join(__dirname, "../../frontend/");

app.use(express.static(frontendPath));

// Para React Router
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});
// -------------------------------

app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
