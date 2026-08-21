export type Profile = "de-general" | "en-general" | "de-radiology";
export type SegmentStatus = "queued" | "processing" | "failed" | "done";

export interface Settings { profile: Profile; dictionary: string; radiologyPack: boolean }
export interface Usage { month: string; audioSeconds: number; lunaInputTokens: number; lunaCachedTokens: number; lunaOutputTokens: number; audioCost: number; lunaCost: number }
export interface DashboardPoint { period: string; dictates: number; audioSeconds: number; audioCost: number; lunaCost: number; totalCost: number }
export interface DashboardData {
  days: 7 | 30 | 365;
  bucket: "day" | "month";
  costTrackingSince: string;
  summary: Omit<DashboardPoint, "period">;
  points: DashboardPoint[];
}
export interface Dictate { id: string; title: string; text: string; createdAt: string; updatedAt: string }
export interface Segment { id: string; sequence: number; dictateId: string; blob: Blob; durationMs: number; mime: string; profile: Profile; status: SegmentStatus; error?: string }
