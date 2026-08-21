import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import multer from "multer";
import { ZodError } from "zod";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { AuthedRequest } from "./types.js";
import { AuthService } from "./auth.js";
import { Store } from "./db.js";
import { OpenAIError, OpenAIService } from "./openai.js";
import { parseDictionary } from "./prompts.js";
import { dashboardQuerySchema, dictateSchema, loginSchema, reviewSchema, settingsSchema, transcribeFieldsSchema } from "./validation.js";

export interface Dependencies { config: Config; store: Store; auth: AuthService; openai: OpenAIService }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 8 }
});

const allowedAudio = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"]);
const route = (handler: (request: Request, response: Response) => unknown | Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => Promise.resolve(handler(request, response)).catch(next);

export function createApp({ config, store, auth, openai }: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  app.use(express.json({ limit: "128kb" }));
  app.use(cookieParser());

  app.get("/health", (_request, response) => response.json({ ok: true }));

  app.post("/api/auth/login", route(async (request, response) => {
    const forwarded = request.header("x-client-ip")?.trim();
    const trustedClientIp = forwarded && isIP(forwarded) ? forwarded : request.socket.remoteAddress || "unknown";
    auth.beginLoginAttempt(trustedClientIp);
    const credentials = loginSchema.parse(request.body);
    const user = await auth.login(credentials.email, credentials.password);
    store.ensureUser(user.id);
    auth.createSession(user, response);
    response.json({ user });
  }));

  app.post("/api/auth/logout", (request, response) => {
    auth.destroySession(request.cookies?.dictate_sid, response);
    response.status(204).end();
  });

  app.use("/api", auth.middleware);

  app.get("/api/me", (request, response) => response.json({ user: (request as AuthedRequest).user }));

  app.get("/api/settings", (request, response) => response.json(store.getSettings((request as AuthedRequest).user!.id)));
  app.put("/api/settings", route((request, response) => {
    const settings = settingsSchema.parse(request.body);
    parseDictionary(settings.dictionary);
    store.setSettings((request as AuthedRequest).user!.id, settings);
    response.json(settings);
  }));

  app.get("/api/dictates", (request, response) => response.json({ items: store.listDictates((request as AuthedRequest).user!.id) }));
  app.put("/api/dictates/:id", route((request, response) => {
    const item = dictateSchema.parse({ ...request.body, id: request.params.id });
    store.upsertDictate((request as AuthedRequest).user!.id, item);
    response.json(item);
  }));
  app.delete("/api/dictates/:id", (request, response) => {
    const removed = store.deleteDictate((request as AuthedRequest).user!.id, request.params.id);
    response.status(removed ? 204 : 404).end();
  });

  app.get("/api/usage", (request, response) => response.json(store.usage((request as AuthedRequest).user!.id)));
  app.get("/api/dashboard", route((request, response) => {
    const { days } = dashboardQuerySchema.parse(request.query);
    response.json(store.dashboard((request as AuthedRequest).user!.id, days));
  }));

  app.post("/api/transcribe", upload.single("audio"), route(async (request, response) => {
    const userId = (request as AuthedRequest).user!.id;
    const fields = transcribeFieldsSchema.parse(request.body);
    if (!request.file) return response.status(400).json({ error: { code: "AUDIO_REQUIRED", message: "Audiodatei fehlt." } });
    const mime = request.file.mimetype.split(";")[0]?.toLowerCase() ?? "";
    if (!allowedAudio.has(mime)) return response.status(415).json({ error: { code: "AUDIO_TYPE", message: "Nicht unterstütztes Audioformat." } });

    const requestFingerprint = createHash("sha256").update(request.file.buffer)
      .update(`\0${fields.profile}\0${fields.durationMs}\0${fields.previous}`).digest("hex").slice(0, 32);
    const idempotencyClientId = `${fields.clientId}:${requestFingerprint}`;
    const reservation = store.reserve(userId, idempotencyClientId, fields.sequence);
    if (reservation.status === "done") return response.json({ text: reservation.response, duplicate: true, usage: store.usage(userId) });
    if (reservation.status === "processing") return response.status(409).json({ error: { code: "IN_PROGRESS", message: "Dieser Abschnitt wird bereits verarbeitet." } });

    try {
      const settings = store.getSettings(userId);
      const text = await openai.transcribe({
        audio: request.file.buffer, mime, filename: request.file.originalname || `segment-${fields.sequence}.webm`,
        profile: fields.profile, dictionary: settings.dictionary, radiologyPack: settings.radiologyPack, previous: fields.previous
      });
      store.addAudioUsage(userId, fields.durationMs / 1000);
      store.complete(userId, idempotencyClientId, fields.sequence, text);
      response.json({ text, duplicate: false, usage: store.usage(userId) });
    } catch (error) {
      store.release(userId, idempotencyClientId, fields.sequence);
      throw error;
    }
  }));

  app.post("/api/review", route(async (request, response) => {
    const userId = (request as AuthedRequest).user!.id;
    const input = reviewSchema.parse(request.body);
    const settings = store.getSettings(userId);
    const result = await openai.review(input.text, input.profile, input.mode, settings.dictionary);
    const inTokens = result.usage.input_tokens ?? 0, cached = result.usage.input_tokens_details?.cached_tokens ?? 0, outTokens = result.usage.output_tokens ?? 0;
    store.addLunaUsage(userId, inTokens, cached, outTokens);
    response.json({ text: result.text, usage: store.usage(userId) });
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return response.status(400).json({ error: { code: "INVALID_INPUT", message: error.issues[0]?.message ?? "Ungültige Eingabe." } });
    if (error instanceof multer.MulterError) return response.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: error.code, message: error.code === "LIMIT_FILE_SIZE" ? "Audioabschnitt ist größer als 4 MB." : "Ungültiger Upload." } });
    if (error instanceof OpenAIError) return response.status(error.quota ? 429 : 502).json({ error: { code: error.quota ? "QUOTA_EXHAUSTED" : "OPENAI_ERROR", message: error.message } });
    const known = error as { status?: number; message?: string };
    const status = known.status && known.status >= 400 && known.status < 600 ? known.status : 500;
    response.status(status).json({ error: { code: status === 500 ? "INTERNAL" : "REQUEST_FAILED", message: status === 500 ? "Interner Serverfehler." : known.message ?? "Anfrage fehlgeschlagen." } });
  });

  return app;
}
