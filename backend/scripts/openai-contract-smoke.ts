import { readFile } from "node:fs/promises";
import path from "node:path";

const key = process.env.OPENAI_DEV_TEST_KEY;
const audioPath = process.env.OPENAI_TEST_AUDIO;
if (!key || !audioPath) {
  console.error("Manueller Smoke: OPENAI_DEV_TEST_KEY und OPENAI_TEST_AUDIO (anonymisierte Audiodatei) setzen.");
  process.exit(2);
}

const bytes = await readFile(path.resolve(audioPath));
const form = new FormData();
form.append("model", "gpt-transcribe");
form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "anonymous.wav");
form.append("languages[]", "de");
form.append("keywords[]", "BI-RADS");
form.append("prompt", "Anonymisiertes deutschsprachiges Testdiktat. Nur Gesprochenes transkribieren.");
const transcription = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
if (!transcription.ok) throw new Error(`Transcription contract failed: ${transcription.status} ${await transcription.text()}`);
const transcript = await transcription.json() as { text?: string };
if (!transcript.text) throw new Error("Transcription response contained no text");

const revision = await fetch("https://api.openai.com/v1/responses", {
  method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ model: "gpt-5.6-luna", reasoning: { effort: "none" }, store: false, max_output_tokens: 8192,
    instructions: "Korrigiere nur die Rechtschreibung. Gib ausschließlich Klartext zurück.", input: transcript.text })
});
if (!revision.ok) throw new Error(`Responses contract failed: ${revision.status} ${await revision.text()}`);
const response = await revision.json() as { output_text?: string };
if (!response.output_text) throw new Error("Responses response contained no output_text");
console.log("OpenAI contract smoke passed (transcription + Luna response).");
