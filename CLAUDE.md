# Dictate — Whisper Speech-to-Text

## Was ist das?
Browser-basiertes Sprach-Diktierwerkzeug. Nutzt die OpenAI Whisper API zur Transkription. Zwei Varianten: Desktop (PiP-Popup) und Mobile (PWA für iOS).

## Dateien
```
dictate.html          ← Desktop-App (PiP, Chrome/Edge 116+)
dictate-mobile.html   ← Mobile PWA (iOS, Fullscreen)
manifest.json         ← PWA Manifest (Icons, Display-Mode)
sw.js                 ← Service Worker (Offline-Cache)
icon-192.png          ← App-Icon 192x192
icon-512.png          ← App-Icon 512x512
```

## Hosting
GitHub Pages: `https://mfsh3.github.io/dictate/`
- HTTPS automatisch (nötig für Mikrofon + Clipboard + PWA)
- Aktiviert über Settings → Pages → Source: main

## Benutzung

### Desktop
1. `dictate.html` in Chrome/Edge öffnen
2. API Key eingeben, Sprache wählen
3. "Dictate starten" → PiP-Popup öffnet sich (always-on-top)
4. **Space** oder Klick → diktieren → **Space** → Text wird transkribiert + auto-kopiert
5. Weitere Diktate appenden (newline-separiert) an die laufende Session
6. **Escape** oder **× Button** → Aufnahme abbrechen (kein API-Call, keine Kosten)
7. **🗑 Leeren** → aktuelle Session in History schieben, frische Session starten
8. **◀ Live/n/10 ▶** → durch die letzten 10 Sessions navigieren
9. Textbox ist editierbar — Änderungen werden im aktuellen Buffer oder im History-Eintrag persistiert
10. In Ziel-App → **Ctrl+V**

### Mobile (iOS)
1. `mfsh3.github.io/dictate/dictate-mobile.html` in Safari öffnen
2. Share → "Zum Home-Bildschirm" (einmalig)
3. App öffnen, API Key eingeben
4. Record-Button tippen → diktieren → Stop tippen
5. **Kopieren-Button tippen** → in Ziel-App wechseln → Einfügen
   (kein Auto-Copy auf iOS — Clipboard-API erlaubt es nur im direkten Tap-Handler)

## Architektur

### Desktop (`dictate.html`)
- **Setup Page:** API Key + Sprache konfigurieren, Mikrofon anfordern
- **PiP Widget:** `documentPictureInPicture` API, DOM frisch per `createElement` aufgebaut
- **Fallback:** Wenn PiP nicht verfügbar → Widget inline
- **Auto-Copy:** Transkription geht automatisch ins Clipboard (kompletter Session-Buffer, nicht nur der neue Schnipsel)
- **State-Modell:** `current` = aktiver Session-Buffer (wächst per Append), `hist[]` = bis zu 10 abgeschlossene Sessions, `histIdx` = Anzeige-Position (`-1` = Live). **Wichtig:** Variable heißt `hist`, nicht `history` — `window.history` ist [Unforgeable] und schluckt jede `var history` Deklaration
- **Cancel:** Während Aufnahme neutralisiert `cancelR()` `mediaRec.onstop` bevor `mediaRec.stop()` aufgerufen wird → `transcribe()` feuert nicht, `chunks[]` werden verworfen

### Mobile (`dictate-mobile.html`)
- **Single-View:** Kein Setup-Screen, alles in einer View (Settings als Toggle-Panel)
- **Fullscreen PWA:** `display: standalone`, kein Safari-UI
- **Zwei-Tap-Copy:** Expliziter Kopieren-Button (iOS-Clipboard-Limitation)
- **Safe Areas:** `env(safe-area-inset-*)` für Notch/Dynamic Island

### Gemeinsam
- **State:** Alles in `localStorage` (Keys: `dc_k` = API Key, `dc_l` = Sprache, `dc_c` = Kosten, `dc_h` = Session-History JSON-Array, max. 10 Einträge, newest first — nur Desktop)
- **Kein Build-System:** Alles inline (HTML + CSS + JS), keine externen Dependencies außer Google Fonts

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
- SVG Icons: Mic, Stop, Wait, X — inline erzeugt per `createElementNS`

## Einschränkungen

### Desktop
- Kein globaler Hotkey — Space funktioniert nur im Widget-Fenster
- PiP braucht Chrome/Edge 116+
- Mikrofon braucht Secure Context (localhost oder HTTPS)

### Mobile
- Kein Auto-Copy (iOS-Clipboard-API nur im User-Gesture-Handler)
- `MediaRecorder` braucht iOS 14.3+
- Whisper-API braucht Internet (kein Offline-Transkription)
- Cancel / Session-Append / History / Editable Textbox: **nur Desktop**, Mobile hinkt dem Modell hinterher

### Allgemein
- Auf Firmenrechnern: .exe und PowerShell-Scripts können geblockt sein — diese HTML-Lösung umgeht das

## Vorgeschichte
Ursprünglich ein AutoHotkey-Script (~120 MB mit ffmpeg, AHK, PowerShell). Wurde schrittweise vereinfacht:
1. AHK → C# WinForms (24 KB .exe) — geblockt durch Firmen-Virenscanner
2. C# → PowerShell Add-Type (in-memory) — geblockt durch Corporate Policy
3. PowerShell → **Browser HTML** (24 KB, zero dependencies) ← aktuelle Lösung
