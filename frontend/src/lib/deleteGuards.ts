import type { Event, Test, TestPart } from "../types";

function normalizeNumber(n: string): string {
  const s = String(n || "").trim();
  const stripped = s.replace(/^0+/, "");
  return stripped || "0";
}

function penaltyIsActive(p: {
  timePenaltyMs?: number;
  positionPenalty?: number;
  comment?: string;
}): boolean {
  return (
    (p.timePenaltyMs || 0) > 0 ||
    (p.positionPenalty || 0) > 0 ||
    Boolean((p.comment || "").trim())
  );
}

function pilotNumbersInPart(part: TestPart): Set<string> {
  const nums = new Set<string>();
  for (const slot of part.csvs || []) {
    const passages = slot.parsed?.racePassages || [];
    for (const p of passages) {
      if (p.number) nums.add(normalizeNumber(p.number));
    }
  }
  return nums;
}

export function partHasPenalties(test: Test, part: TestPart): boolean {
  const inPart = pilotNumbersInPart(part);
  if (inPart.size === 0) return false;
  return (test.penalties || []).some(
    (p) => inPart.has(normalizeNumber(p.number)) && penaltyIsActive(p)
  );
}

export function canDeleteEvent(event: Event): string | null {
  if (event.tests.length > 0) {
    return `Este evento tiene ${event.tests.length} prueba(s). Elimina todas las pruebas antes de borrar el evento.`;
  }
  return null;
}

export function canDeleteTest(event: Event, test: Test): string | null {
  if (test.parts.length > 0) {
    return `«${test.name}» tiene ${test.parts.length} salida(s). Elimina las salidas antes de borrar la prueba.`;
  }
  const fusions = (event.fusions || []).filter((f) => f.testIds.includes(test.id));
  if (fusions.length > 0) {
    const names = fusions.map((f) => `«${f.name}»`).join(", ");
    return `La prueba está incluida en la fusión ${names}. Elimina esas fusiones primero.`;
  }
  return null;
}

export function canDeletePart(event: Event, test: Test, part: TestPart): string | null {
  const fusions = (event.fusions || []).filter((f) => f.testIds.includes(test.id));
  if (fusions.length > 0) {
    const names = fusions.map((f) => `«${f.name}»`).join(", ");
    return `«${test.name}» está incluida en la fusión ${names}. Elimina esas fusiones antes de borrar cualquier salida.`;
  }
  if (partHasPenalties(test, part)) {
    return "Esta salida tiene pilotos con penalizaciones. Elimínalas y pulsa OK en cada fila antes de borrar la salida.";
  }
  return null;
}
