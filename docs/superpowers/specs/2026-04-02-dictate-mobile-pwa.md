# Dictate Mobile PWA — Spec

## Zusammenfassung
Separate `dictate-mobile.html` als Progressive Web App (PWA) für iOS. Gleiche Whisper-Transkription wie Desktop, aber Fullscreen statt PiP. Zwei-Tap-Flow fürs Kopieren (iOS-Clipboard-Limitation).

## Entscheidungen

| Punkt | Entscheidung | Grund |
|-------|-------------|-------|
| Datei | `dictate-mobile.html` (separat) | Desktop=PiP, Mobile=Fullscreen — fundamental verschiedene UX |
| Clipboard | Expliziter Kopieren-Button | iOS Safari erlaubt `writeText()` nur im User-Gesture-Handler, nicht nach async fetch |
| Layout | Record unten, Textarea groß, Copy prominent | Daumen-erreichbar, Mobile-First |
| Design | Sonic Architect (identisch Desktop) | Konsistenz |
| Hosting | GitHub Pages `mfsh3.github.io/dictate/` | HTTPS gratis, PWA-kompatibel |

## Architektur

### Eine Datei, kein Build
Alles inline in `dictate-mobile.html`: HTML + CSS + JS. Keine externen Dependencies außer Google Fonts und der OpenAI API.

### Kein Setup-Screen
Anders als Desktop gibt es keine separate Setup-Seite. Beim ersten Start öffnet sich direkt die App-View mit dem Settings-Panel sichtbar (API Key muss eingegeben werden). Danach merkt sich die App den Key und zeigt beim nächsten Start direkt das Widget.

### PWA-Manifest
- `manifest.json` im Repo-Root (Name, Icons, theme_color, display: standalone)
- `<link rel="manifest">` + Apple-spezifische Meta-Tags in der HTML
- App-Icon: Inline SVG als Data-URI (kein separates PNG nötig — oder einfaches 192x192 PNG)
- `display: standalone` → Fullscreen ohne Safari-UI

### Service Worker
Minimal — nur für PWA-Installierbarkeit. Cached die HTML-Datei und Fonts für Offline-Start. Die Whisper-API braucht natürlich Internet.

## Layout

```
╭─────────────────────────────╮
│  S:$0.00  T:$0.01  Σ:$0.42 │  Kosten (kompakt, Manrope)
│                             │
│ ┌─────────────────────────┐ │
│ │                         │ │
│ │  Transkription...       │ │  Textarea (flex-grow, füllt Platz)
│ │                         │ │
│ │                         │ │
│ │                         │ │
│ └─────────────────────────┘ │
│                             │
│    [📋 Kopieren]    [🗑]    │  Copy prominent, Clear klein
│                             │
│         ( 🎙 )              │  Record-Button (60px, zentriert)
│      Space / Tap            │  Status-Text + Waveform
│                             │
│              ⚙              │  Gear (Settings toggle)
╰─────────────────────────────╯
```

### Settings-Panel
Gleich wie Desktop: ersetzt die Textarea temporär. API Key + Sprache + Speichern.

## Technische Details

### Audio
- `MediaRecorder` API (WebM/Opus oder MP4 Fallback)
- iOS Safari unterstützt `MediaRecorder` seit 14.3
- Fallback-Check: wenn `MediaRecorder` nicht verfügbar → Fehlermeldung

### Clipboard (Zwei-Tap-Flow)
1. User tippt Record → Aufnahme startet
2. User tippt Stop → Aufnahme stoppt, Whisper-API wird aufgerufen
3. Text erscheint in Textarea, Status: "Fertig — Kopieren tippen"
4. User tippt den **Kopieren-Button** → `navigator.clipboard.writeText()` im Click-Handler → funktioniert auf iOS
5. Status: "Im Clipboard!"

### Viewport / Mobile
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`
- `height: 100dvh` (dynamic viewport height — berücksichtigt iOS Safe Areas)
- `padding: env(safe-area-inset-*)` für Notch/Dynamic Island
- Touch: `touch-action: manipulation` (kein Double-Tap-Zoom)

### Farben (Sonic Architect)
Identisch zur Desktop-Version:
- Background: `#0e0e0f`
- Surfaces: `#131314` → `#1a191b` → `#262627`
- Accent: `#b6a0ff` / `#7e51ff`
- No-Line Rule: Tiefe durch Hintergrund-Abstufungen, keine Borders

### State
Gleich wie Desktop: `localStorage` (Keys: `dc_k`, `dc_l`, `dc_c`)

## Dateien

```
/opt/Dictate/
├── dictate.html           (Desktop, unverändert)
├── dictate-mobile.html    (NEU — Mobile PWA)
├── manifest.json          (NEU — PWA Manifest)
├── sw.js                  (NEU — Service Worker, minimal)
├── icon-192.png           (NEU — App Icon)
├── icon-512.png           (NEU — App Icon groß)
├── CLAUDE.md
└── README.md
```

## Nicht im Scope
- Offline-Transkription (Whisper braucht Internet)
- Push Notifications
- Hintergrund-Aufnahme
- Android-spezifische Anpassungen (funktioniert aber trotzdem)
