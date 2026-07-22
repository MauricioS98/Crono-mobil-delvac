import { normalizeNumber } from "./storage.js";
import { formatMs } from "./timeUtils.js";
import { computeTestResults, resolveTestTimingPoints, segmentLabelForTest } from "./results.js";
import type { Event, FusionRow, FusionTestTime, Test } from "./types.js";

export interface FusionResult {
  title: string;
  tests: { id: string; name: string; segmentLabel: string }[];
  rows: FusionRow[];
  warning?: string;
}

export function computeFusionResults(event: Event, testIds: string[]): FusionResult {
  const uniqueIds = [...new Set(testIds.filter(Boolean))];
  if (uniqueIds.length < 2) {
    return {
      title: "Fusión de pruebas",
      tests: [],
      rows: [],
      warning: "Selecciona al menos 2 pruebas para fusionar.",
    };
  }

  const tests: Test[] = [];
  for (const id of uniqueIds) {
    const test = event.tests.find((t) => t.id === id);
    if (test) tests.push(test);
  }

  if (tests.length < 2) {
    return {
      title: "Fusión de pruebas",
      tests: [],
      rows: [],
      warning: "No se encontraron suficientes pruebas válidas.",
    };
  }

  const testMeta = tests.map((test) => ({
    id: test.id,
    name: test.name,
    segmentLabel: segmentLabelForTest(event, test),
  }));

  const warnings: string[] = [];
  const perPilot = new Map<
    string,
    {
      number: string;
      name: string;
      category: string;
      league: string;
      byTest: Map<string, { timeMs: number; timeFormatted: string; laps?: number }>;
    }
  >();

  for (const test of tests) {
    const { fromId, toId } = resolveTestTimingPoints(event, test);
    const { rows, warning } = computeTestResults(event, test, fromId, toId);
    if (warning) warnings.push(`${test.name}: ${warning}`);

    for (const row of rows) {
      if (row.incomplete) continue;
      const key = normalizeNumber(row.number);
      let entry = perPilot.get(key);
      if (!entry) {
        entry = {
          number: row.number,
          name: row.name,
          category: row.category,
          league: row.league,
          byTest: new Map(),
        };
        perPilot.set(key, entry);
      }
      if (row.name) entry.name = row.name;
      if (row.category) entry.category = row.category;
      if (row.league) entry.league = row.league;

      entry.byTest.set(test.id, {
        timeMs: row.timeMs,
        timeFormatted: row.timeFormatted,
        laps: row.laps,
      });
    }
  }

  const fusionRows: FusionRow[] = [];
  for (const [, pilot] of perPilot) {
    let totalMs = 0;
    let testsCount = 0;
    const byTest: FusionTestTime[] = testMeta.map((meta) => {
      const t = pilot.byTest.get(meta.id);
      if (t) {
        totalMs += t.timeMs;
        testsCount++;
        return {
          testId: meta.id,
          testName: meta.name,
          segmentLabel: meta.segmentLabel,
          timeMs: t.timeMs,
          timeFormatted: t.timeFormatted,
          laps: t.laps,
        };
      }
      return {
        testId: meta.id,
        testName: meta.name,
        segmentLabel: meta.segmentLabel,
        timeMs: null,
        timeFormatted: "—",
      };
    });

    if (testsCount === 0) continue;

    fusionRows.push({
      position: 0,
      number: pilot.number,
      name: pilot.name,
      category: pilot.category,
      league: pilot.league,
      totalTimeMs: totalMs,
      totalTimeFormatted: formatMs(totalMs),
      testsCount,
      byTest,
    });
  }

  fusionRows.sort((a, b) => a.totalTimeMs - b.totalTimeMs);
  fusionRows.forEach((r, i) => {
    r.position = i + 1;
  });

  const title = `Fusión — ${tests.map((t) => t.name).join(" + ")}`;

  return {
    title,
    tests: testMeta,
    rows: fusionRows,
    warning: fusionRows.length === 0 ? warnings[0] || "Sin tiempos para fusionar." : warnings[0],
  };
}
