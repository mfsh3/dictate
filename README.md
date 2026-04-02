# 🎙 Dictate

**Whisper Speech-to-Text** — Browser-basiert, keine Installation, keine Abhängigkeiten.

Zwei Varianten: **Desktop** (Always-on-top Popup) und **Mobile** (iOS PWA).

## Desktop

1. `dictate.html` in **Chrome oder Edge** öffnen
2. OpenAI API Key eingeben, Sprache wählen
3. **"Dictate starten"** → schwebendes Always-on-top Popup
4. **Space** → diktieren → **Space** → Text wird transkribiert + auto-kopiert
5. **Ctrl+V** in der Ziel-App

## Mobile (iOS)

1. **[dictate-mobile.html](https://mfsh3.github.io/dictate/dictate-mobile.html)** in Safari öffnen
2. Share → **"Zum Home-Bildschirm"** (einmalig)
3. App öffnen, API Key eingeben
4. Record-Button tippen → sprechen → Stop tippen
5. **"Kopieren"** tippen → in Ziel-App wechseln → Einfügen

## Features

- 🎤 Aufnahme via Browser-Mikrofon (MediaRecorder API)
- 🧠 Transkription über OpenAI Whisper API
- 📋 Clipboard-Integration (Desktop: auto, Mobile: ein Tap)
- 💰 Kostentracking (Session / Tag / Gesamt)
- ⚙️ Inline-Einstellungen
- 🌙 "Sonic Architect" Design (Dark Mode)

## Warum?

Gebaut für Arbeitsrechner auf denen man keine Software installieren kann — kein .exe, kein Installer, keine Admin-Rechte nötig. Nur ein Browser.

## Voraussetzungen

**Desktop:** Chrome/Edge 116+ (Picture-in-Picture)
**Mobile:** iOS 14.3+ (MediaRecorder), Safari

Beide: OpenAI API Key ([platform.openai.com](https://platform.openai.com)) + Mikrofon

## Kosten

Whisper API: **$0.006 pro Minute** Audioaufnahme. Eine Stunde Diktieren kostet ~$0.36.
