import { useEffect, useMemo, useRef, useState } from "react";
import type { FusionRow, ResultRow } from "../../types";
import { PositionRow } from "./PositionRow";
import { RB_ASSETS } from "./pilotArt";
import "./redbull.css";

type Section = {
  title: string;
  rows: (ResultRow | FusionRow)[];
};

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
  if (ms <= 0) return "";
  const totalSec = ms / 1000;
  if (totalSec < 60) return `+${totalSec.toFixed(3)}`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec - min * 60;
  return `+${min}:${sec.toFixed(3).padStart(6, "0")}`;
}

const PAGE_SIZE = 8;
const PAGE_HOLD_MS = 2000;
const ROW_STAGGER_MS = 100;
const ROW_ENTER_MS = 220;
const PAGE_EXIT_MS = 280;

export type RedBullOverlayProps = {
  error: string;
  section: Section | null;
  showGap: boolean;
  showHeader: boolean;
  top: number;
};

type ViewRow = {
  key: string;
  position: number;
  number: string;
  name: string;
  time: string;
  gap: string;
  traps: { time: string; label: string }[];
};

const TRAYECTO_LABELS = ["1er trayecto", "2do trayecto", "3er trayecto"];

function buildTraps(r: ResultRow | FusionRow): { time: string; label: string }[] {
  if (isFusionRow(r)) return [];
  const segs = (r.segments || []).filter((s) => s.timeFormatted);
  if (segs.length < 1) return [];
  const partials = segs.slice(0, 2).map((s, i) => ({
    time: s.timeFormatted,
    label: TRAYECTO_LABELS[i] || `${i + 1}º trayecto`,
  }));
  // Live / unfinished: only show sectors we have (e.g. 1er trayecto), no Total yet
  const inProgress = /en curso/i.test(r.segmentLabel || "");
  if (inProgress) return partials;
  return [...partials, { time: rowTimeFormatted(r), label: "Total" }];
}

function toViewRows(
  rows: (ResultRow | FusionRow)[],
  showGap: boolean,
  leaderMs: number
): ViewRow[] {
  return rows.map((r) => {
    const ms = rowTimeMs(r);
    const traps = buildTraps(r);
    const gap =
      traps.length === 0 && showGap && r.position > 1 && leaderMs && ms
        ? formatGap(ms - leaderMs)
        : "";
    return {
      key: String(r.number || `p${r.position}`),
      position: r.position,
      number: String(r.number || ""),
      name: r.name || "—",
      time: rowTimeFormatted(r),
      gap,
      traps,
    };
  });
}

function membershipKey(rows: ViewRow[]): string {
  return rows.map((r) => r.key).join("|");
}

function contentSig(rows: ViewRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.key}:${r.position}:${r.time}:${r.gap}:${r.name}:${r.traps.map((t) => t.time).join(",")}`
    )
    .join(";");
}

/** Show prueba name; drop salida / resultado suffixes from board titles. */
function displayTestName(title: string): string {
  return String(title || "")
    .replace(/\s*[—–|-]\s*Resultado.*$/i, "")
    .replace(/\s*[—–|-]\s*Salida\s*\d*.*$/i, "")
    .replace(/\s*\(\s*Salida\s*\d*\s*\)\s*$/i, "")
    .trim();
}

type LogoPhase = "idle" | "phase1" | "phase2" | "phase3" | "done";

export function RedBullOverlay({
  error,
  section,
  showGap,
  showHeader,
  top,
}: RedBullOverlayProps) {
  const allRows = useMemo(() => {
    if (!section) return [] as ViewRow[];
    const sliced = section.rows.slice(0, top);
    const leaderMs = sliced.length > 0 ? rowTimeMs(sliced[0]) : 0;
    return toViewRows(sliced, showGap, leaderMs);
  }, [section, showGap, top]);

  const testName = useMemo(
    () => displayTestName(section?.title || ""),
    [section?.title]
  );

  const hasSplits = useMemo(
    () => allRows.some((r) => r.traps.length > 0),
    [allRows]
  );

  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE) || 1);
  const [page, setPage] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [panelIn, setPanelIn] = useState(false);
  const [logoPhase, setLogoPhase] = useState<LogoPhase>("idle");
  const [headersIn, setHeadersIn] = useState(false);
  const [rowsReady, setRowsReady] = useState(false);
  const [animGen, setAnimGen] = useState(0);
  const pageRef = useRef(0);

  const safePage = ((page % pageCount) + pageCount) % pageCount;
  const livePageRows = useMemo(
    () => allRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [allRows, safePage]
  );
  const liveMemberKey = useMemo(() => membershipKey(livePageRows), [livePageRows]);
  const liveContentSig = useMemo(() => contentSig(livePageRows), [livePageRows]);

  const [displayRows, setDisplayRows] = useState<ViewRow[]>([]);
  const membershipRef = useRef("");

  useEffect(() => {
    const t = window.setTimeout(() => setPanelIn(true), 40);
    return () => window.clearTimeout(t);
  }, []);

  // Logo cinematic sequence → title/test name → rows
  useEffect(() => {
    if (!showHeader) {
      setLogoPhase("done");
      setHeadersIn(true);
      setRowsReady(true);
      return;
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setLogoPhase("phase1"), 80));
    timers.push(window.setTimeout(() => setLogoPhase("phase2"), 80 + 300));
    timers.push(window.setTimeout(() => setLogoPhase("phase3"), 80 + 300 + 80));
    timers.push(
      window.setTimeout(() => {
        setLogoPhase("done");
        setHeadersIn(true);
      }, 80 + 300 + 420)
    );
    timers.push(
      window.setTimeout(() => {
        setRowsReady(true);
        setAnimGen((g) => g + 1);
      }, 80 + 300 + 420 + 280)
    );
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [showHeader]);

  // Initial / in-place sync (no re-stagger when membership unchanged)
  useEffect(() => {
    if (exiting) return;
    if (!membershipRef.current) {
      membershipRef.current = liveMemberKey;
      setDisplayRows(livePageRows);
      return;
    }
    if (liveMemberKey === membershipRef.current) {
      setDisplayRows(livePageRows);
      return;
    }
    membershipRef.current = liveMemberKey;
    setDisplayRows(livePageRows);
    setAnimGen((g) => g + 1);
  }, [liveMemberKey, liveContentSig, livePageRows, exiting]);

  // Auto-paginate — do NOT depend on `exiting` or cleanup will cancel the page swap
  useEffect(() => {
    if (!rowsReady || pageCount <= 1 || displayRows.length === 0) return;

    const buildMs = displayRows.length * ROW_STAGGER_MS + ROW_ENTER_MS;
    let swapTimer: number | null = null;
    const hold = window.setTimeout(() => {
      setExiting(true);
      swapTimer = window.setTimeout(() => {
        const next = (pageRef.current + 1) % pageCount;
        pageRef.current = next;
        const nextRows = allRows.slice(next * PAGE_SIZE, next * PAGE_SIZE + PAGE_SIZE);
        membershipRef.current = membershipKey(nextRows);
        setDisplayRows(nextRows);
        setPage(next);
        setAnimGen((g) => g + 1);
        setExiting(false);
      }, PAGE_EXIT_MS);
    }, buildMs + PAGE_HOLD_MS);

    return () => {
      window.clearTimeout(hold);
      if (swapTimer != null) window.clearTimeout(swapTimer);
    };
  }, [pageCount, safePage, animGen, allRows, displayRows.length, rowsReady]);

  useEffect(() => {
    if (page >= pageCount) {
      pageRef.current = 0;
      setPage(0);
    }
  }, [page, pageCount]);

  if (error) {
    return (
      <div className="rb-stage">
        <div className="rb-error">Sin conexión con el cronometraje</div>
      </div>
    );
  }

  if (!section) {
    return <div className="rb-stage" />;
  }

  const animKey = `${safePage}-${animGen}`;

  const logoClasses = [
    "rb-logo-stack",
    logoPhase !== "idle" ? "rb-logo--phase1" : "",
    logoPhase === "phase2" || logoPhase === "phase3" || logoPhase === "done"
      ? "rb-logo--phase2"
      : "",
    logoPhase === "phase3" || logoPhase === "done" ? "rb-logo--phase3" : "",
    logoPhase === "done" ? "rb-logo--done" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rb-stage">
      <div
        className={[
          "rb-panel",
          panelIn ? "rb-panel--in" : "",
          headersIn ? "rb-panel--headers-in" : "",
          hasSplits ? "rb-panel--splits" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <img className="rb-layer rb-fondo" src={RB_ASSETS.fondo} alt="" draggable={false} />
        {showHeader && (
          <>
            <div className={logoClasses}>
              <img
                className="rb-logo-layer rb-logo-base"
                src={RB_ASSETS.logoBase}
                alt=""
                draggable={false}
              />
              <div className="rb-logo-urbano-mask">
                <img
                  className="rb-logo-layer"
                  src={RB_ASSETS.logoUrbano}
                  alt=""
                  draggable={false}
                />
              </div>
              <img
                className="rb-logo-layer rb-logo-moto"
                src={RB_ASSETS.logoMoto}
                alt=""
                draggable={false}
              />
              <img
                className="rb-logo-layer rb-logo-redbull"
                src={RB_ASSETS.logoRedbull}
                alt=""
                draggable={false}
              />
            </div>
            <img className="rb-layer rb-title" src={RB_ASSETS.title} alt="" draggable={false} />
            {testName ? <div className="rb-section-label">{testName}</div> : null}
          </>
        )}
        <div
          className={`rb-rows${rowsReady ? "" : " rb-rows--hold"}`}
          aria-label="Tabla de posiciones"
        >
          {rowsReady &&
            displayRows.map((r, i) => (
              <PositionRow
                key={r.key}
                position={r.position}
                number={r.number}
                name={r.name}
                time={r.time}
                gap={r.gap}
                traps={r.traps}
                enterIndex={i}
                animKey={animKey}
                exiting={exiting}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
