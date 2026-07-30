const ASSET_BASE = "/overlays/redbull";

/** Normalize pilot name for slug matching (accents, spaces, punctuation). */
export function normalizePilotSlug(name: string): string {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Known art filenames that don't match a naive name slug
 * (typos / truncated export names from the design pack).
 */
const NAME_ALIASES: Record<string, string> = {
  cesarcorrea: "esarcorrea",
  esarcorrea: "esarcorrea",
};

/** Dorsal → art slug once PNGs are renamed to `{number}.png`. */
export function pilotArtCandidates(number: string, name: string): string[] {
  const dorsal = String(number || "").trim();
  const slug = normalizePilotSlug(name);
  const alias = NAME_ALIASES[slug];
  const out: string[] = [];
  if (dorsal) {
    out.push(`${ASSET_BASE}/pilots/${dorsal}.png`);
    // zero-padded variants (01, 001)
    if (/^\d+$/.test(dorsal)) {
      out.push(`${ASSET_BASE}/pilots/${dorsal.padStart(2, "0")}.png`);
      out.push(`${ASSET_BASE}/pilots/${dorsal.padStart(3, "0")}.png`);
    }
  }
  if (slug) out.push(`${ASSET_BASE}/pilots/${slug}.png`);
  if (alias) out.push(`${ASSET_BASE}/pilots/${alias}.png`);
  return [...new Set(out)];
}

export function posBadgeUrl(position: number): string | null {
  if (position >= 1 && position <= 16) {
    return `${ASSET_BASE}/pos/${position}.png`;
  }
  return null;
}

export const RB_ASSETS = {
  fondo: `${ASSET_BASE}/fondo.png`,
  logo: `${ASSET_BASE}/logo.png`,
  title: `${ASSET_BASE}/title.png`,
  row: `${ASSET_BASE}/row.png`,
} as const;
