import "express-async-errors";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes.js";
import { HEADERS_DIR } from "./storage.js";
import { assertDbConnection, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/uploads/headers", express.static(HEADERS_DIR));
app.use("/api", routes);

app.get("/api/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT current_database() AS db");
    res.json({ ok: true, service: "Minerva Timing", database: r.rows[0].db });
  } catch (err) {
    res.status(503).json({
      ok: false,
      service: "Minerva Timing",
      error: err instanceof Error ? err.message : "DB error",
    });
  }
});

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Error interno";
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
);

async function main() {
  await assertDbConnection();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Minerva Timing API en http://localhost:${PORT} (LAN: 0.0.0.0:${PORT})`);
  });
}

main().catch((err) => {
  console.error("No se pudo iniciar la API:", err);
  process.exit(1);
});
