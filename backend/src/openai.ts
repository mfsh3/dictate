import type { OpenAIUsage, Profile, ReviewMode } from "./types.js";
import { reviewInstructions, transcriptionContext } from "./prompts.js";

export class OpenAIError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly quota = false) { super(message); }
}

async function parseError(response: Response) {
  let body: any = {};
  try { body = await response.json(); } catch {}
  const raw = String(body?.error?.message ?? `OpenAI HTTP ${response.status}`);
  const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
  const quota = response.status === 429 && (/quota|billing|limit/i.test(raw) || code === "insufficient_quota");
  return new OpenAIError(quota ? "Das OpenAI-Projektlimit ist erreicht. Audio bleibt lokal erhalten." : `OpenAI-Anfrage fehlgeschlagen (${response.status}).`, response.status, code, quota);
}

export class OpenAIService {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}

  private headers() {
    if (!this.apiKey) throw new OpenAIError("OPENAI_API_KEY ist nicht konfiguriert.", 503);
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async transcribe(input: { audio: Buffer; mime: string; filename: string; profile: Profile; dictionary: string; radiologyPack: boolean; previous: string }) {
    const context = transcriptionContext(input.profile, input.dictionary, input.radiologyPack, input.previous);
    const form = new FormData();
    form.append("model", "gpt-transcribe");
    form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mime }), input.filename);
    form.append("prompt", context.prompt);
    for (const language of context.languages) form.append("languages[]", language);
    for (const keyword of context.keywords) form.append("keywords[]", keyword);
    let response: Response;
    try { response = await this.fetcher("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: this.headers(), body: form, signal: AbortSignal.timeout(120_000) }); }
    catch (error) { if (error instanceof OpenAIError) throw error; throw new OpenAIError("OpenAI ist derzeit nicht erreichbar. Audio bleibt lokal erhalten.", 502); }
    if (!response.ok) throw await parseError(response);
    const body = await response.json() as { text?: string };
    const text = body.text?.trim();
    if (!text) throw new OpenAIError("OpenAI hat ein leeres Transkript geliefert.", 502);
    return text;
  }

  async review(text: string, profile: Profile, mode: ReviewMode, dictionary: string) {
    let response: Response;
    try { response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST", headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6-luna", reasoning: { effort: "none" }, store: false,
        instructions: reviewInstructions(profile, mode, dictionary), input: text, max_output_tokens: 8192
      }), signal: AbortSignal.timeout(120_000)
    }); } catch (error) { if (error instanceof OpenAIError) throw error; throw new OpenAIError("OpenAI ist derzeit nicht erreichbar. Der Originaltext bleibt unverändert.", 502); }
    if (!response.ok) throw await parseError(response);
    const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: OpenAIUsage };
    const output = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("") ?? "";
    if (!output.trim()) throw new OpenAIError("OpenAI hat keinen Überarbeitungstext geliefert.", 502);
    return { text: output, usage: body.usage ?? {} };
  }
}
