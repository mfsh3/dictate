# 🎙 Dictate

**Whisper Speech-to-Text als Browser-Popup** — eine einzige HTML-Datei (24 KB), keine Installation, keine Abhängigkeiten.

## So funktioniert's

1. `dictate.html` in **Chrome oder Edge** öffnen
2. OpenAI API Key eingeben, Sprache wählen
3. **"Dictate starten"** → ein schwebendes Always-on-top Popup öffnet sich
4. **Space** drücken → diktieren → **Space** → Text wird transkribiert und automatisch ins Clipboard kopiert
5. **Ctrl+V** in der Ziel-App

## Features

- 🎤 Aufnahme via Browser-Mikrofon (MediaRecorder API)
- 🧠 Transkription über OpenAI Whisper API
- 📋 Auto-Copy ins Clipboard nach jeder Transkription
- 💰 Kostentracking (Session / Tag / Gesamt)
- ⚙️ Inline-Einstellungen direkt im Popup
- 🌙 Dark Mode Design ("Sonic Architect" Farbschema)

## Warum?

Gebaut für Arbeitsrechner auf denen man keine Software installieren kann — kein .exe, kein Installer, keine Admin-Rechte nötig. Nur ein Browser.

## Voraussetzungen

- Chrome 116+ oder Edge 116+ (für Picture-in-Picture)
- OpenAI API Key ([platform.openai.com](https://platform.openai.com))
- Mikrofon

## Kosten

Whisper API: **$0.006 pro Minute** Audioaufnahme. Eine Stunde Diktieren kostet ~$0.36.
