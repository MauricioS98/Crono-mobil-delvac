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
app.use("/uploads/headers", express.static(HEADERS_DIR));
app.use("/api", routes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "Minerva Timing" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Minerva Timing API en http://localhost:${PORT} (LAN: 0.0.0.0:${PORT})`);
});
