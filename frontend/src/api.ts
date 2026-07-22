import type { Event, Pilot, ResultRow } from "./types";

const BASE = "/api";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Error de red");
  }
  return res.json();
}

export const api = {
  listEvents: () => request<Event[]>("/events"),
  getEvent: (id: string) => request<Event>(`/events/${id}`),
  createEvent: (data: Partial<Event>) =>
    request<Event>("/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateEvent: (id: string, data: Partial<Event>) =>
    request<Event>(`/events/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: string) => request<{ ok: boolean }>(`/events/${id}`, { method: "DELETE" }),

  updateTimingPoints: (id: string, timingPoints: unknown[]) =>
    request<Event>(`/events/${id}/timing-points`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timingPoints }),
    }),

  uploadHeader: async (id: string, file: File) => {
    const fd = new FormData();
    fd.append("image", file);
    return request<Event>(`/events/${id}/header`, { method: "POST", body: fd });
  },

  createTest: (eventId: string, name: string) =>
    request(`/events/${eventId}/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: "", showDescriptionInPdf: false }),
    }),
  updateTest: (
    eventId: string,
    testId: string,
    data: { name?: string; description?: string; showDescriptionInPdf?: boolean }
  ) =>
    request(`/events/${eventId}/tests/${testId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteTest: (eventId: string, testId: string) =>
    request(`/events/${eventId}/tests/${testId}`, { method: "DELETE" }),

  createPart: (eventId: string, testId: string, data: { name?: string; combinedMode?: boolean }) =>
    request(`/events/${eventId}/tests/${testId}/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updatePart: (
    eventId: string,
    testId: string,
    partId: string,
    data: { name?: string; combinedMode?: boolean }
  ) =>
    request(`/events/${eventId}/tests/${testId}/parts/${partId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deletePart: (eventId: string, testId: string, partId: string) =>
    request(`/events/${eventId}/tests/${testId}/parts/${partId}`, { method: "DELETE" }),

  uploadCsv: async (
    eventId: string,
    testId: string,
    partId: string,
    file: File,
    timingPointId: string,
    combinedMode?: boolean
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("timingPointId", timingPointId);
    if (combinedMode) fd.append("combinedMode", "true");
    return request<{ part: unknown; summary: unknown }>(
      `/events/${eventId}/tests/${testId}/parts/${partId}/csv`,
      { method: "POST", body: fd }
    );
  },

  getResults: (eventId: string, testId: string, params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    return request<{ title: string; rows: ResultRow[]; warning?: string | null; eventName: string }>(
      `/events/${eventId}/tests/${testId}/results?${q}`
    );
  },

  exportUrl: (eventId: string, testId: string, format: string, params: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) q.set(k, v);
    });
    return `${BASE}/events/${eventId}/tests/${testId}/export/${format}?${q}`;
  },

  listPilots: (eventId: string) => request<Pilot[]>(`/events/${eventId}/pilots`),
  previewPilotsImport: async (eventId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{
      filename: string;
      columns: { index: number; label: string; header: string }[];
      headerOrder: string;
      sampleRows: string[][];
      suggestedMapping: Record<string, number>;
      totalDataRows: number;
    }>(`/events/${eventId}/pilots/import/preview`, { method: "POST", body: fd });
  },
  importPilots: async (
    eventId: string,
    file: File,
    mapping: Record<string, number | undefined>,
    skipFirstRow = true
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));
    fd.append("skipFirstRow", String(skipFirstRow));
    return request<{
      pilots: Pilot[];
      summary: { total: number; added: number; updated: number; skipped: number; filename: string };
    }>(`/events/${eventId}/pilots/import`, { method: "POST", body: fd });
  },
  createPilot: (eventId: string, data: Partial<Pilot>) =>
    request<Pilot>(`/events/${eventId}/pilots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updatePilot: (eventId: string, pilotId: string, data: Partial<Pilot>) =>
    request<Pilot>(`/events/${eventId}/pilots/${pilotId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deletePilot: (eventId: string, pilotId: string) =>
    request(`/events/${eventId}/pilots/${pilotId}`, { method: "DELETE" }),
};

export function formatOffsetInput(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(Math.round(ms));
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const milli = abs % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}
