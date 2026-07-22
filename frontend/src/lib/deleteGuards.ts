import type { Event, Test } from "../types";

export function testHasPenalties(test: Test): boolean {
  return (test.penalties || []).some(
    (p) =>
      (p.timePenaltyMs || 0) > 0 ||
      (p.positionPenalty || 0) > 0 ||
      Boolean((p.comment || "").trim())
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

export function canDeletePart(test: Test): string | null {
  if (testHasPenalties(test)) {
    return "La prueba tiene penalizaciones registradas. Elimínalas antes de borrar esta salida.";
  }
  return null;
}
