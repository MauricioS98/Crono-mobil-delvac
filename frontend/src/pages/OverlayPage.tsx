import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { hexToRgba, resolveThemeColors } from "../theme";
import type { FusionRow, ResultRow } from "../types";

type BoardData = Awaited<ReturnType<typeof api.getBoard>>;
type Section = BoardData["sections"][number];

function isFusionRow(r: ResultRow | FusionRow): r is FusionRow {
  return "totalTimeFormatted" in r;
}

function rowTimeMs(r: ResultRow | FusionRow): number {
  return isFusionRow(r) ? r.totalTimeMs : r.timeMs;
}

function rowTimeFormatted(r: ResultRow | FusionRow): string {
  return isFusionRow(r) ? r.totalTimeFormatted : r.timeFormatted;
}

function formatGap(ms: number): string {
  if (ms <= 0) return "—";
  const totalSec = ms / 1000;
  if (totalSec < 60) return `+${totalSec.toFixed(3)}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  return `+${min}:${sec.toFixed(3).padStart(6, "0")}`;
}

export function OverlayPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState("");

  const top = Math.max(1, Number(params.get("top")) || 20);
  const refreshSec = Math.max(2, Number(params.get("refresh")) || 5);
  const showGap = params.get("gap") !== "0";
  const showHeader = params.get("header") !== "0";
  const sectionParam = (params.get("section") || "").trim();

  // Fondo transparente para OBS/vMix (browser source)
  useEffect(() => {
    document.documentElement.classList.add("overlay-transparent");
    document.body.classList.add("overlay-transparent");
    return () => {
      document.documentElement.classList.remove("overlay-transparent");
      document.body.classList.remove("overlay-transparent");
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const board = await api.getBoard(id);
      setData(board);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => undefined);
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, refreshSec * 1000);
    return () => window.clearInterval(timer);
  }, [load, refreshSec]);

  const section: Section | null = useMemo(() => {
    if (!data || data.sections.length === 0) return null;
    if (sectionParam) {
      const byId = data.sections.find((s) => s.entry.id === sectionParam);
      if (byId) return byId;
      const idx = Number(sectionParam);
      if (Number.isInteger(idx) && idx >= 1 && idx <= data.sections.length) {
        return data.sections[idx - 1];
      }
      return null;
    }
    // Por defecto: la última sección publicada (mayor order)
    return data.sections[data.sections.length - 1];
  }, [data, sectionParam]);

  // Colores del evento (con la paleta Minerva como respaldo)
  const [cAccent, cAccent2, cPanel, cText] = resolveThemeColors(data?.event.themeColors);
  const themeStyle = {
    "--ov-accent": cAccent,
    "--ov-accent2": cAccent2,
    "--ov-head-bg": hexToRgba(cPanel, 0.96),
    "--ov-row-bg": hexToRgba(cPanel, 0.88),
    "--ov-p1-bg": hexToRgba(cPanel, 0.96),
    "--ov-text": cText,
    "--ov-text-soft": hexToRgba(cText, 0.6),
  } as CSSProperties;

  if (error) {
    return (
      <div className="overlay-root" style={themeStyle}>
        <div className="overlay-tower">
          <div className="overlay-head">
            <span className="overlay-head-title">Sin conexión con el cronometraje</span>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !section) {
    return <div className="overlay-root" style={themeStyle} />;
  }

  const rows = section.rows.slice(0, top);
  const leaderMs = rows.length > 0 ? rowTimeMs(rows[0]) : 0;

  return (
    <div className="overlay-root" style={themeStyle}>
      <div className="overlay-tower">
        {showHeader && (
          <div className="overlay-head">
            <span className="overlay-head-event">{data.event.name}</span>
            <span className="overlay-head-title">{section.title}</span>
          </div>
        )}
        <div className="overlay-rows">
          {rows.map((r) => {
            const ms = rowTimeMs(r);
            const league = "league" in r ? r.league : "";
            const gapText =
              showGap && r.position > 1 && leaderMs && ms ? formatGap(ms - leaderMs) : "";
            const segments =
              "segments" in r && Array.isArray(r.segments) ? r.segments : [];
            const hasSegments = segments.length > 0;
            return (
              <div
                key={`${r.position}-${r.number}`}
                className={`overlay-row${hasSegments ? " overlay-row-segs" : ""}${r.position <= 3 ? ` overlay-p${r.position}` : ""}`}
              >
                <span className="overlay-pos">{r.position}</span>
                <span className="overlay-num">{r.number}</span>
                <span className="overlay-driver">
                  <span className="overlay-name">{r.name || "—"}</span>
                  {league && <span className="overlay-league">{league}</span>}
                  {hasSegments && (
                    <span className="overlay-segs">
                      {segments.map((s) => `${s.from}→${s.to} ${s.timeFormatted}`).join(" · ")}
                    </span>
                  )}
                </span>
                <span className="overlay-timing">
                  <span className="overlay-time">{rowTimeFormatted(r)}</span>
                  {gapText && <span className="overlay-gap">{gapText}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
