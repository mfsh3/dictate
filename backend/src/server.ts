import { loadConfig } from "./config.js";
import { prepareState } from "./security.js";
import { Vault } from "./crypto.js";
import { Store } from "./db.js";
import { AuthService } from "./auth.js";
import { OpenAIService } from "./openai.js";
import { createApp } from "./app.js";

process.umask(0o077);
const config = loadConfig();
const key = prepareState(config.stateDir, config.dbPath, config.keyPath);
const store = new Store(config.dbPath, new Vault(key));
store.cleanup();
const cleanupTimer = setInterval(() => store.cleanup(), 24 * 3600_000);
cleanupTimer.unref();

const app = createApp({ config, store, auth: new AuthService(config), openai: new OpenAIService(config.openAiKey) });
const server = app.listen(config.port, "0.0.0.0", () => console.log(`Dictate backend listening on ${config.port}`));

function shutdown() {
  server.close(() => { store.close(); process.exit(0); });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
