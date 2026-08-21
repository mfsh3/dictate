import path from "node:path";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  STATE_DIR: z.string().min(1).default("/opt/dictate-state/dev"),
  OPENAI_API_KEY: z.string().default(""),
  AUTH_MODE: z.enum(["mock", "radsup"]).default("mock"),
  RADSUP_AUTH_URL: z.literal("https://radsup.bj7r2d.de/api/auth/login").default("https://radsup.bj7r2d.de/api/auth/login"),
  RADSUP_CA_PATH: z.string().min(1).default("/opt/dictate-state/dev/radsup-dev-ca.pem"),
  MOCK_ADMIN_EMAIL: z.string().email().default("admin@example.test"),
  MOCK_ADMIN_PASSWORD: z.string().min(1).default("change-me")
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(input);
  if (value.NODE_ENV === "production" && value.AUTH_MODE === "mock") {
    throw new Error("AUTH_MODE=mock ist in Produktion nicht erlaubt");
  }
  return {
    env: value.NODE_ENV,
    port: value.PORT,
    stateDir: path.resolve(value.STATE_DIR),
    dbPath: path.resolve(value.STATE_DIR, "dictate.db"),
    keyPath: path.resolve(value.STATE_DIR, "data.key"),
    openAiKey: value.OPENAI_API_KEY,
    authMode: value.AUTH_MODE,
    radsupUrl: value.RADSUP_AUTH_URL,
    radsupCaPath: path.resolve(value.RADSUP_CA_PATH),
    mockEmail: value.MOCK_ADMIN_EMAIL.toLowerCase(),
    mockPassword: value.MOCK_ADMIN_PASSWORD
  } as const;
}
