/** Parse times like 8:14:06.408 or 8:14:06.408 with comma decimals, or 1:50.635 */
export function parseTimeToMs(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim().replace(",", ".");
  const parts = s.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const sec = Number(parts[2]);
    if ([h, m, sec].some((x) => Number.isNaN(x))) return null;
    return Math.round(h * 3600000 + m * 60000 + sec * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const sec = Number(parts[1]);
    if ([m, sec].some((x) => Number.isNaN(x))) return null;
    return Math.round(m * 60000 + sec * 1000);
  }
  const sec = Number(s);
  if (Number.isNaN(sec)) return null;
  return Math.round(sec * 1000);
}

/** Format ms as hh:mm:ss.xxx (or mm:ss.xxx if under 1h) */
export function formatMs(ms: number, forceHours = false): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ms));
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const milli = abs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  if (forceHours || h > 0) {
    return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
  }
  return `${sign}${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

/** Parse offset string hh:mm:ss.xxx or hh:mm:ss:xxx */
export function parseOffsetToMs(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  let s = raw.trim().replace(",", ".");
  // Support hh:mm:ss:xxx (colon before millis)
  const colonParts = s.split(":");
  if (colonParts.length === 4) {
    s = `${colonParts[0]}:${colonParts[1]}:${colonParts[2]}.${colonParts[3]}`;
  }
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const ms = parseTimeToMs(s);
  if (ms === null) return 0;
  return negative ? -ms : ms;
}

export function formatOffset(ms: number): string {
  return formatMs(ms, true);
}
