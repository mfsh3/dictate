import type { DashboardData, Dictate, Profile, Settings, Usage } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options?.body instanceof FormData ? {} : { "content-type": "application/json" }), ...options?.headers } });
  if (response.status === 204) return undefined as T;
  let body: any = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `HTTP ${response.status}`);
  return body as T;
}

export const api = {
  me: () => request<{ user: { email: string } }>("/api/me"),
  login: (email: string, password: string) => request<{ user: { email: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Settings) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  dictates: () => request<{ items: Dictate[] }>("/api/dictates"),
  saveDictate: (item: Dictate) => request<Dictate>(`/api/dictates/${item.id}`, { method: "PUT", body: JSON.stringify(item) }),
  removeDictate: (id: string) => request<void>(`/api/dictates/${id}`, { method: "DELETE" }),
  usage: () => request<Usage>("/api/usage"),
  dashboard: (days: 7 | 30 | 365) => request<DashboardData>(`/api/dashboard?days=${days}`),
  transcribe: (input: { blob: Blob; clientId: string; sequence: number; durationMs: number; profile: Profile; previous: string }) => {
    const form = new FormData();
    const ext = input.blob.type.includes("mp4") ? "m4a" : input.blob.type.includes("ogg") ? "ogg" : "webm";
    form.append("audio", input.blob, `segment-${input.sequence}.${ext}`); form.append("clientId", input.clientId);
    form.append("sequence", String(input.sequence)); form.append("durationMs", String(Math.round(input.durationMs)));
    form.append("profile", input.profile); form.append("previous", input.previous.slice(-300));
    return request<{ text: string; duplicate: boolean; usage: Usage }>("/api/transcribe", { method: "POST", body: form });
  },
  review: (text: string, profile: Profile, mode: "spelling" | "fillers") => request<{ text: string; usage: Usage }>("/api/review", { method: "POST", body: JSON.stringify({ text, profile, mode }) })
};
