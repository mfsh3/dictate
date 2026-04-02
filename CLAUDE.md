# Dictate — Whisper Speech-to-Text

## Was ist das?
Eine einzige HTML-Datei (24 KB) die als Browser-basiertes Sprach-Diktierwerkzeug funktioniert. Nutzt die OpenAI Whisper API zur Transkription. Läuft als Picture-in-Picture Popup das über anderen Fenstern schwebt.

## Datei
```
dictate.html    ← Die komplette App (HTML + CSS + JS, alles inline)
```

## Benutzung
1. `dictate.html` in Chrome/Edge öffnen (direkt oder via localhost)
2. API Key eingeben, Sprache wählen
3. "Dictate starten" → PiP-Popup öffnet sich (always-on-top)
4. **Space** oder Klick auf den Record-Button → diktieren → **Space** → Text wird transkribiert und automatisch ins Clipboard kopiert
5. In Ziel-App wechseln → **Ctrl+V**

## Architektur
- **Setup Page:** Hauptseite im Browser-Tab — API Key + Sprache konfigurieren, Mikrofon anfordern
- **PiP Widget:** Wird per `documentPictureInPicture` API als Floating-Fenster geöffnet. Das Widget-DOM wird komplett frisch per `createElement` aufgebaut (kein innerHTML, kein DOM-Move zwischen Fenstern)
- **Fallback:** Wenn PiP nicht verfügbar ist, wird das Widget inline unter dem Setup gerendert
- **State:** Alles in `localStorage` (Keys: `dc_k` = API Key, `dc_l` = Sprache, `dc_c` = Kosten)

## Design System: "Sonic Architect"
- Farbpalette: Deep Black (#0e0e0f) + Electric Purple (#b6a0ff / #7e51ff)
- No-Line Rule: Keine 1px Borders — Tiefe durch Hintergrund-Abstufungen
- Glassmorphism für Settings-Panel (backdrop-filter: blur)
- Fonts: Manrope (Headlines/Labels) + Inter (Body) via Google Fonts
- Record Button: Gradient mit Glow-Shadow + animierter Outer Ring
- Ambient Glow: Subtiler radialer Gradient im Hintergrund

## Technische Details
- Audio: `MediaRecorder` API (WebM/Opus oder MP4 Fallback)
- API: `fetch()` an `https://api.openai.com/v1/audio/transcriptions`
- Clipboard: `navigator.clipboard.writeText()` mit `execCommand('copy')` Fallback
- Hotkey: Space-Taste (nur wenn PiP/Widget fokussiert, kein globaler Hotkey)
- Kosten: $0.006/Minute, getrackt pro Session/Tag/Gesamt
- SVG Icons: Mic, Stop, Wait — inline erzeugt per `createElementNS`

## Einschränkungen
- Kein globaler Hotkey (Browser-Limitation) — Space funktioniert nur im Widget-Fenster
- PiP braucht Chrome/Edge 116+
- Mikrofon-Zugriff braucht Secure Context (localhost oder HTTPS). Direkte `file://` URLs funktionieren in Firefox, in Chrome/Edge ggf. nicht
- Auf Firmenrechnern: .exe und PowerShell-Scripts können geblockt sein — diese HTML-Lösung umgeht das

## Vorgeschichte
Ursprünglich ein AutoHotkey-Script (~120 MB mit ffmpeg, AHK, PowerShell). Wurde schrittweise vereinfacht:
1. AHK → C# WinForms (24 KB .exe) — geblockt durch Firmen-Virenscanner
2. C# → PowerShell Add-Type (in-memory) — geblockt durch Corporate Policy
3. PowerShell → **Browser HTML** (24 KB, zero dependencies) ← aktuelle Lösung
