import type { Request } from "express";

export type Profile = "de-general" | "en-general" | "de-radiology";
export type ReviewMode = "spelling" | "fillers";

export interface SessionUser {
  id: string;
  email: string;
  role: "ADMIN";
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
}

export interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}
