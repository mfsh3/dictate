# Dictate MVP

Dictate ist ein browserbasiertes Blockdiktat für DE Alltag, EN Alltag und DE Radiologie. Der MVP besteht aus einem React/Vite-Frontend hinter Nginx und einem internen Express/TypeScript-Backend mit SQLite. OpenAI-Zugangsdaten befinden sich ausschließlich im Backend.

Die früheren statischen Dateien `dictate.html` und `dictate-mobile.html` bleiben als GitHub-Pages-Legacy-Version erhalten und sind nicht Teil des Docker-Stacks.

## Enthalten

- Push-to-talk per Leertaste sowie klickbarer Aufnahmebutton
- WebM/Opus mit 64 kbit/s, 90-Sekunden-Rollover und 60-Sekunden-Sicherheitsstopp
- geordnete Audio-Queue mit Idempotenz, Retry und lokalem Blob-Download
- Re-Login-Overlay bei Sitzungsverlust ohne Verlust des React-Zustands
- persönliches Wörterbuch (`Begriff` oder `gehört => Schreibweise`) und Radiologie-Grundpaket
- editierbarer Text, verschlüsselter 30-Tage-Verlauf, manuelles und Best-Effort-Auto-Copy
- PiP-Steuerung in unterstützten Chromium-Browsern
- installierbare iPhone-PWA mit Safe-Area-Layout, einmaligem Mikrofon-Onboarding und Halten/Hochschieben-Aufnahmegeste
- manuelle Luna-Überarbeitung mit Original/Vorschau und Übernehmen/Verwerfen
- geschätzte Transcribe- sowie anhand der API-Nutzung berechnete Luna-Kosten

Nicht enthalten sind Realtime-Transkription, verbindliche Android-Abnahme, globale Betriebssystem-Hotkeys, Prisma, Admin-UI und Backups.

## iPhone-PWA

Auf dem iPhone `https://dictate.radsup.de` in Safari öffnen und über **Teilen → Zum Home-Bildschirm** installieren. Die Mikrofonfreigabe wird einmal von iOS für die Website erteilt und bei späteren Starts wiederverwendet, solange sie nicht in den Safari-Website-Einstellungen widerrufen wird.

Der mobile Aufnahmebutton arbeitet wie bei einer Messenger-App: gedrückt halten nimmt auf, Loslassen stoppt und Hochschieben verriegelt die Aufnahme. API-Antworten, Sitzungen, Diktattexte und Audio werden niemals vom Service Worker gecacht; offline steht nur die App-Oberfläche zur Verfügung. Die frühere `dictate-mobile.html` bleibt eine nicht angebundene Legacy-Version.

## Lokale Entwicklung

Voraussetzung ist Node.js 22 oder neuer.

```bash
npm install
cp .env.example .env
install -d -m 0700 /tmp/dictate-state
```

Danach in `.env` `STATE_DIR=/tmp/dictate-state`, `AUTH_MODE=mock` und einen `OPENAI_API_KEY` konfigurieren. Das Secure-Session-Cookie verlangt auch in der Browserentwicklung HTTPS; API-Tests funktionieren ohne Browser-Cookie-Ausnahme.

```bash
npm run dev:backend
npm run dev:frontend
```

Mock-Zugangsdaten kommen aus `MOCK_ADMIN_EMAIL` und `MOCK_ADMIN_PASSWORD`. `AUTH_MODE=mock` wird bei `NODE_ENV=production` abgelehnt.

## Tests und OpenAI-Contract-Smoke

```bash
npm run typecheck
npm test
npm run build
```

Der echte OpenAI-Smoke läuft bewusst nie in CI und liest nicht den normalen Deployment-Key. Er benötigt einen expliziten Dev-Test-Key und eine anonymisierte Audiodatei:

```bash
OPENAI_DEV_TEST_KEY=... OPENAI_TEST_AUDIO=/absolute/anonymized.wav npm run contract:smoke
```

Geprüft werden `gpt-transcribe` mit `languages[]`, `keywords[]` und `prompt` sowie `gpt-5.6-luna` über `/v1/responses` mit `reasoning.effort: none`, `store: false` und `max_output_tokens: 8192`.

## State und Berechtigungen

Der Dev-Stack erwartet:

```text
/opt/dictate-state/dev/
├── dictate.db          0600 (wird angelegt)
├── data.key            0600 (wird angelegt)
└── radsup-dev-ca.pem   0644 oder strenger
```

Das Verzeichnis muss `0700` besitzen. Das Backend verweigert den Start bei abweichenden DB-/Schlüsselrechten und auch dann, wenn eine vorhandene Datenbank ihren Schlüssel verloren hat. Text, Titel und Wörterbuch sind mit AES-256-GCM verschlüsselt. Es gibt absichtlich weder Schlüsselrotation noch Backup oder Recovery. Diktate älter als 30 Tage werden beim Start und danach täglich physisch entfernt.

Audio liegt nur im Browserzustand und im Multipart-Memory-Storage. Es wird nie in SQLite oder ein Upload-Verzeichnis geschrieben. Der Proxy streamt `/api/transcribe` ohne Request-Buffering und begrenzt den Request auf 4 MB.

## RadsUp-Dev-Anmeldung

Das Ziel `https://radsup.bj7r2d.de/api/auth/login` ist im Konfigurationsschema fest verdrahtet. Der eigene HTTPS-Client vertraut ausschließlich der Datei `RADSUP_CA_PATH`; `rejectUnauthorized` bleibt aktiv. RadsUp-Cookies werden ignoriert. Nach erfolgreicher Antwort wird ausschließlich `user.role === "ADMIN"` akzeptiert und eine acht Stunden gültige In-Memory-Sitzung erzeugt.

`dictate_sid` ist `HttpOnly`, `Secure`, `SameSite=Strict` und host-only. Ein Backend-Neustart widerruft alle Sitzungen. Loginversuche sind auf zwei je Client-IP und vier RadsUp-Aufrufe global pro Minute begrenzt. Der vorgeschaltete Nginx setzt dafür intern `X-Client-IP`; dieser Header wird nie an RadsUp weitergereicht.

Vor dem Umschalten von Mock auf RadsUp müssen Admin-/Nicht-Admin, falsches/abgelaufenes/geändertes Zertifikat und Ausfall mit der realen Dev-Instanz geprüft werden.

## Deployment

> **Temporärer Dev-Betrieb (seit 2026-08-21):** Für den ersten MVP-Smoke verwendet Dictate den bereits vorhandenen RadsUp-Dev-OpenAI-Key. Vor der MVP-Abnahme muss er durch ein eigenes Dictate-Dev-Projekt mit separatem Key und hartem Monatslimit von 25 USD ersetzt werden.

1. Das OpenAI-Dev-Projekt extern auf ein hartes Monatslimit von 25 USD setzen.
2. `/opt/dictate-state/dev` mit Eigentümer des Container-Users und Modus `0700` vorbereiten.
3. das aktuelle RadsUp-Dev-CA-/Self-Signed-Zertifikat als `radsup-dev-ca.pem` ablegen.
4. `.env` aus `.env.example` erstellen, `AUTH_MODE=radsup` und den Dev-OpenAI-Key setzen.
5. das externe Docker-Netz `edge_net` muss bereits existieren und Nginx Proxy Manager enthalten.
6. `docker compose build` und `docker compose up -d` verwenden — nicht `docker compose down`.
7. NPM auf `dictate_frontend:8080` zeigen lassen und den Inhalt von `deploy/npm-proxy-host-advanced.conf` übernehmen.

Nur das Frontend hängt an `edge_net`; das Backend hat keine veröffentlichten Ports, besitzt über sein Compose-Netz aber den nötigen ausgehenden Zugriff auf RadsUp und OpenAI.

Nach Infrastrukturänderungen sind Dictate, RadsUp und Kasm zu prüfen. Ein Wechsel zu RadsUp-Prod bleibt eine getrennte Freigabe mit eigenem Stack, Schlüssel und OpenAI-Projekt.

## Manuelle Abnahme

- Admin-/Nicht-Admin-Login, RadsUp-Zertifikatfehler und RadsUp-Ausfall
- Sitzungsauslauf/Backend-Neustart während Aufnahme und Queue, danach Re-Login
- Leertaste halten/loslassen, Texteingabefokus, Button-Toggle, Escape und Mikrofonverlust
- 90-Sekunden-Rollover, 60-Sekunden-Stille, Queue-Reihenfolge, Retry und Idempotenz
- Projektlimit mitten in einer Queue; Blob bleibt download- und retryfähig
- Clipboard-Erfolg sowie erwarteter `NotAllowedError`
- iPhone Safari und installierte PWA: erste Mikrofonfreigabe, Neustart ohne erneuten Hinweis, Halten/Loslassen und Hochschieben zum Verriegeln
- maximal gültiger Upload ohne Nginx-Tempfile
- mehrere anonymisierte reale DE-, EN- und Radiologieläufe auf `dictate.radsup.de`

Die automatischen Tests decken Verschlüsselung, Rechte, Wörterbuch, Session-Neustart, Uploadlimit, Idempotenz, Queue-Reihenfolge und Kostenfelder ab. Externe TLS-, Browser-, NPM- und echte Modelltests bleiben bewusst Teil der manuellen Dev-Abnahme.
