import { z } from "zod";

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) });
export const settingsSchema = z.object({
  profile: z.enum(["de-general", "en-general", "de-radiology"]),
  dictionary: z.string().max(20_000), radiologyPack: z.boolean()
});
export const dictateSchema = z.object({
  id: z.string().uuid(), title: z.string().max(200), text: z.string().max(100_000),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime()
});
export const reviewSchema = z.object({ text: z.string().min(1).max(40_000), mode: z.enum(["spelling", "fillers"]), profile: z.enum(["de-general", "en-general", "de-radiology"]) });
export const transcribeFieldsSchema = z.object({
  clientId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  durationMs: z.coerce.number().min(300).max(91_000), profile: z.enum(["de-general", "en-general", "de-radiology"]), previous: z.string().max(300).default("")
});
