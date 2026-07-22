import type { Event, Test } from "./types.js";

export function testHasPenalties(test: Test): boolean {
  return (test.penalties || []).some(
    (p) =>
      (p.timePenaltyMs || 0) > 0 ||
      (p.positionPenalty || 0) > 0 ||
      Boolean((p.comment || "").trim())
  );
}

export function testUsedInFusions(event: Event, testId: string) {
  return (event.fusions || []).filter((f) => f.testIds.includes(testId));
}

export function assertCanDeleteEvent(event: Event): string | null {
  if (event.tests.length > 0) {
    return `No se puede eliminar el evento porque tiene ${event.tests.length} prueba(s). Elimina las pruebas primero.`;
  }
  return null;
}

export function assertCanDeleteTest(event: Event, test: Test): string | null {
  if (test.parts.length > 0) {
    return `No se puede eliminar la prueba porque tiene ${test.parts.length} salida(s). Elimina las salidas primero.`;
  }
  const fusions = testUsedInFusions(event, test.id);
  if (fusions.length > 0) {
    const names = fusions.map((f) => `«${f.name}»`).join(", ");
    return `No se puede eliminar la prueba porque está incluida en la fusión: ${names}. Elimina esas fusiones primero.`;
  }
  return null;
}

export function assertCanDeletePart(test: Test): string | null {
  if (testHasPenalties(test)) {
    return "No se puede eliminar la salida porque la prueba tiene penalizaciones registradas. Elimina las penalizaciones primero.";
  }
  return null;
}
