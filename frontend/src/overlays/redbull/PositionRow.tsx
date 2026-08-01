import { useEffect, useState } from "react";
import { pilotArtCandidates } from "./pilotArt";

export type PositionRowProps = {
  position: number;
  number: string;
  name: string;
  time: string;
  gap: string;
  /** Stagger index within the current page (0-based) */
  enterIndex: number;
  /** Re-trigger enter animation when page/generation changes */
  animKey: string;
  exiting?: boolean;
  /** Reserved for future ↑↓ / highlight / record states */
  highlighted?: boolean;
  delta?: "up" | "down" | "same" | null;
  record?: boolean;
};

const STAGGER_MS = 100;

function posBadgeSrc(position: number): string | null {
  if (position >= 1 && position <= 16) {
    return `/overlays/redbull/pos-num/${position}.png`;
  }
  return null;
}

export function PositionRow({
  position,
  number,
  name,
  time,
  gap,
  enterIndex,
  animKey,
  exiting = false,
  highlighted = false,
  delta = null,
  record = false,
}: PositionRowProps) {
  const candidates = pilotArtCandidates(number, name);
  const [artIdx, setArtIdx] = useState(0);
  const [entered, setEntered] = useState(false);
  const [badgeFailed, setBadgeFailed] = useState(false);
  const badgeSrc = !badgeFailed ? posBadgeSrc(position) : null;

  useEffect(() => {
    setArtIdx(0);
  }, [number, name]);

  useEffect(() => {
    setBadgeFailed(false);
  }, [position]);

  useEffect(() => {
    setEntered(false);
    const t = window.setTimeout(() => setEntered(true), enterIndex * STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [animKey, enterIndex]);

  const artSrc = artIdx < candidates.length ? candidates[artIdx] : null;

  return (
    <div
      className={[
        "rb-row",
        entered && !exiting ? "rb-row--in" : "",
        exiting ? "rb-row--out" : "",
        highlighted ? "rb-row--hot" : "",
        record ? "rb-row--record" : "",
        delta === "up" ? "rb-row--up" : "",
        delta === "down" ? "rb-row--down" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ transitionDelay: exiting ? "0ms" : `${enterIndex * STAGGER_MS}ms` }}
      data-pos={position}
      data-number={number}
    >
      <img className="rb-row-bg" src="/overlays/redbull/row.png" alt="" draggable={false} />
      {badgeSrc ? (
        <img
          className="rb-row-pos-img"
          src={badgeSrc}
          alt={String(position)}
          draggable={false}
          onError={() => setBadgeFailed(true)}
        />
      ) : (
        <span className="rb-row-pos">{position}</span>
      )}
      <div className="rb-row-name">
        {artSrc ? (
          <img
            className="rb-row-art"
            src={artSrc}
            alt={name}
            draggable={false}
            onError={() => setArtIdx((i) => i + 1)}
          />
        ) : (
          <span className="rb-row-name-fallback">{(name || "—").toUpperCase()}</span>
        )}
      </div>
      <div className="rb-row-timing">
        <span className="rb-row-time">{time}</span>
        {gap ? <span className="rb-row-gap">{gap}</span> : null}
      </div>
    </div>
  );
}
