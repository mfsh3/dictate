# Dictate repository notes

The active MVP is the TypeScript workspace in `frontend/` and `backend/`. Read `README.md` for architecture, security invariants, tests, and deployment.

The root files `dictate.html`, `dictate-mobile.html`, `manifest.json`, `sw.js`, and the icons are the preserved GitHub Pages legacy application. Do not put API keys from that legacy client into the new MVP and do not remove the legacy deployment before MVP acceptance.

Important invariants:

- RadsUp authentication is Dev-only and server-fixed; never accept an auth target from a browser request.
- Never disable TLS verification. Only the RadsUp client may receive the configured Dev CA.
- Keep sessions in memory and the cookie Secure/HttpOnly/SameSite=Strict.
- Keep audio in RAM, uploads at 4 MB or less, and proxy request buffering off.
- Encrypt dictate text, titles, and dictionary values before SQLite storage.
- Do not add Realtime transcription to this MVP.
