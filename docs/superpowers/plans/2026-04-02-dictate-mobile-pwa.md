# Dictate Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `dictate-mobile.html` as an iOS PWA — fullscreen Whisper speech-to-text with Sonic Architect design.

**Architecture:** Single inline HTML file (no build). PWA support via `manifest.json` + `sw.js`. Layout is vertical fullscreen: costs top, textarea center (flex-grow), copy+clear buttons, large record button bottom, gear for settings. Two-tap clipboard flow (explicit copy button after transcription).

**Tech Stack:** Vanilla HTML/CSS/JS, MediaRecorder API, OpenAI Whisper API, PWA (manifest + service worker), Google Fonts (Manrope + Inter)

---

## File Structure

| File | Purpose |
|------|---------|
| `dictate-mobile.html` | Complete mobile app (HTML + CSS + JS inline) |
| `manifest.json` | PWA manifest (name, icons, display, theme_color) |
| `sw.js` | Minimal service worker (cache HTML + fonts for offline shell) |
| `icon-192.png` | App icon 192x192 (generated via canvas in a helper script, or simple SVG-to-PNG) |
| `icon-512.png` | App icon 512x512 |

---

### Task 1: PWA Support Files (manifest.json + sw.js)

**Files:**
- Create: `manifest.json`
- Create: `sw.js`

- [ ] **Step 1: Create manifest.json**

```json
{
  "name": "Dictate",
  "short_name": "Dictate",
  "description": "Whisper Speech-to-Text",
  "start_url": "./dictate-mobile.html",
  "display": "standalone",
  "background_color": "#0e0e0f",
  "theme_color": "#0e0e0f",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Create sw.js**

Minimal service worker that caches the HTML file and fonts on install, serves from cache with network fallback:

```js
var CACHE = 'dictate-v1';
var URLS = ['./dictate-mobile.html'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(URLS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n) { return n !== CACHE; }).map(function(n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  e.respondWith(
    caches.match(e.request).then(function(r) { return r || fetch(e.request); })
  );
});
```

- [ ] **Step 3: Generate app icons**

Create two PNG icons (purple mic on dark background) using a small inline canvas script, or create simple solid-color PNGs. The icons should use the Sonic Architect palette: `#0e0e0f` background, `#b6a0ff` mic icon.

Use ImageMagick or a canvas-based Node script:

```bash
# Simple solid-color placeholder icons (will be replaced with proper mic icons)
convert -size 192x192 xc:'#0e0e0f' -fill '#b6a0ff' -gravity center -pointsize 120 -annotate 0 '🎙' icon-192.png
convert -size 512x512 xc:'#0e0e0f' -fill '#b6a0ff' -gravity center -pointsize 320 -annotate 0 '🎙' icon-512.png
```

If ImageMagick is not available, create the icons programmatically via a temporary HTML canvas script.

- [ ] **Step 4: Commit**

```bash
git add manifest.json sw.js icon-192.png icon-512.png
git commit -m "feat: add PWA manifest, service worker, and app icons"
```

---

### Task 2: Build dictate-mobile.html — HTML Structure + CSS

**Files:**
- Create: `dictate-mobile.html`

This task builds the complete HTML and CSS. The JS is added in Task 3.

- [ ] **Step 1: Create HTML skeleton with PWA meta tags**

```html
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Dictate">
<meta name="theme-color" content="#0e0e0f">
<link rel="manifest" href="manifest.json">
<link rel="apple-touch-icon" href="icon-192.png">
<title>Dictate</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Write full CSS (Sonic Architect, mobile fullscreen)**

All CSS inline in a `<style>` tag. Key aspects:
- `height: 100dvh` with flexbox column layout
- `env(safe-area-inset-*)` padding
- `touch-action: manipulation` on body
- Textarea: `flex: 1` to fill available space, full width, `#000` background, inset shadow (no border)
- Record button: 60px, centered, purple gradient + glow + outer ring with pulse animation
- Copy button: prominent pill shape with purple accent
- Clear button: small icon button
- Gear: small, bottom center
- Costs: compact top row, Manrope uppercase
- Settings panel: glassmorphism, replaces textarea
- Ambient glow: `body::before` radial gradient
- Waveform bars: 5 animated bars during recording
- Status dot: colored indicator (red=recording, green=copied, transparent=idle)
- All transitions smooth

CSS variables (same as desktop):
```css
:root {
  --bg: #0e0e0f; --surface-low: #131314; --surface: #1a191b;
  --surface-high: #201f21; --surface-bright: #2c2c2d; --surface-top: #262627;
  --text: #ffffff; --muted: #adaaab; --dim: #767576;
  --primary: #b6a0ff; --primary-dim: #7e51ff;
  --danger: #ff6e84; --ok: #22c55e;
}
```

- [ ] **Step 3: Write HTML body structure**

All elements created in HTML (not JS createElement like desktop — no PiP constraints on mobile):

```html
<body>
<div class="app" id="app">
  <!-- Costs row -->
  <div class="costs">
    <span>Sess <b id="cS">$0.000</b></span>
    <span>Today <b id="cT" class="hi">$0.000</b></span>
    <span>Total <b id="cA">$0.000</b></span>
  </div>

  <!-- Textarea (visible) / Settings panel (hidden, toggles) -->
  <textarea class="out" id="out" readonly placeholder="Transkription erscheint hier…"></textarea>
  <div class="settings" id="settings">
    <label for="sKey">API Key</label>
    <input type="password" id="sKey" placeholder="sk-..." autocomplete="off">
    <label for="sLang">Sprache</label>
    <select id="sLang">
      <option value="de">Deutsch</option><option value="en">English</option>
      <option value="fr">Français</option><option value="es">Español</option>
      <option value="it">Italiano</option><option value="nl">Nederlands</option>
      <option value="pt">Português</option><option value="ja">日本語</option>
      <option value="zh">中文</option>
    </select>
    <button class="sv" id="svBtn">Speichern</button>
  </div>

  <!-- Action buttons -->
  <div class="actions">
    <button class="btn-copy" id="cpBtn" disabled>📋 Kopieren</button>
    <button class="btn-clear" id="clBtn" title="Leeren">🗑</button>
  </div>

  <!-- Status -->
  <div class="status-row">
    <span class="dot idle" id="dot"></span>
    <span class="st" id="status">Tap = Aufnahme</span>
    <div class="wave" id="wave"><i></i><i></i><i></i><i></i><i></i></div>
  </div>

  <!-- Record button -->
  <div class="rec-wrap">
    <div class="rb-ring" id="ring"></div>
    <button class="rb" id="recBtn"><!-- SVG mic icon inserted by JS --></button>
  </div>

  <!-- Gear -->
  <div class="gear-row">
    <span class="gear" id="gear" title="Einstellungen">⚙</span>
    <span class="sp"></span>
    <button class="btn-reset" id="rsBtn">↺ costs</button>
  </div>
</div>
</body>
```

- [ ] **Step 4: Verify HTML renders correctly**

Open `dictate-mobile.html` in a browser. Confirm:
- Dark background, Sonic Architect colors
- Textarea fills available vertical space
- Record button is large (60px) and centered at bottom
- Copy button is prominent
- No horizontal overflow
- No visible borders (No-Line Rule)

- [ ] **Step 5: Commit**

```bash
git add dictate-mobile.html
git commit -m "feat: add mobile PWA HTML structure and Sonic Architect CSS"
```

---

### Task 3: Build dictate-mobile.html — JavaScript

**Files:**
- Modify: `dictate-mobile.html` (add `<script>` before `</body>`)

- [ ] **Step 1: Add localStorage helpers + state variables**

Same pattern as desktop — `st()`, `ld()`, `ldC()`, `svC()`, `tKey()` helpers. State vars: `micStream`, `mediaRec`, `chunks`, `recording`, `busy`, `recStart`, `sessCost`, `lastTxt`.

```js
var WHISPER = 'https://api.openai.com/v1/audio/transcriptions', CPM = 0.006;
var micStream = null, mediaRec = null, chunks = [];
var recording = false, busy = false, recStart = 0, sessCost = 0, lastTxt = '';

function st(k, v) { try { localStorage.setItem(k, v) } catch(e) {} }
function ld(k, d) { try { return localStorage.getItem(k) || d } catch(e) { return d } }
function ldC() { try { return JSON.parse(localStorage.getItem('dc_c')) || {} } catch(e) { return {} } }
function svC(c) { st('dc_c', JSON.stringify(c)) }
function tKey() { return new Date().toISOString().slice(0, 10) }
```

- [ ] **Step 2: Add SVG icon factories**

Same `svgIcon()` function and icon paths (ICO_MIC, ICO_STOP, ICO_WAIT) as desktop:

```js
function svgIcon(path, size) {
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'currentColor');
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  s.appendChild(p);
  return s;
}
var ICO_MIC = 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z';
var ICO_STOP = 'M6 6h12v12H6z';
var ICO_WAIT = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z';
```

Note: unlike desktop, `svgIcon` takes no `doc` parameter (always `document`, no PiP).

- [ ] **Step 3: Add init logic — load settings, first-run detection**

On load: read `dc_k` from localStorage. If empty, show settings panel (first run). If key exists, show textarea (normal mode). Populate settings inputs. Insert initial mic icon into record button.

```js
var $out = document.getElementById('out'),
    $settings = document.getElementById('settings'),
    $sKey = document.getElementById('sKey'),
    $sLang = document.getElementById('sLang'),
    $status = document.getElementById('status'),
    $dot = document.getElementById('dot'),
    $wave = document.getElementById('wave'),
    $recBtn = document.getElementById('recBtn'),
    $ring = document.getElementById('ring'),
    $cpBtn = document.getElementById('cpBtn'),
    $clBtn = document.getElementById('clBtn'),
    $rsBtn = document.getElementById('rsBtn'),
    $svBtn = document.getElementById('svBtn'),
    $gear = document.getElementById('gear'),
    $cS = document.getElementById('cS'),
    $cT = document.getElementById('cT'),
    $cA = document.getElementById('cA');

// Init
$sKey.value = ld('dc_k', '');
$sLang.value = ld('dc_l', 'de');
$recBtn.appendChild(svgIcon(ICO_MIC, 28));
renderCosts();

// First run: show settings if no API key
var settingsOpen = !ld('dc_k', '').trim();
applySettingsView(settingsOpen);
```

- [ ] **Step 4: Add settings toggle, save, gear button logic**

```js
function applySettingsView(open) {
  settingsOpen = open;
  $settings.classList.toggle('open', open);
  $out.style.display = open ? 'none' : '';
  $gear.textContent = open ? '\u2715' : '\u2699';
  $gear.title = open ? 'Schließen' : 'Einstellungen';
}

$gear.addEventListener('click', function() {
  applySettingsView(!settingsOpen);
});

$svBtn.addEventListener('click', function() {
  var k = $sKey.value.trim();
  if (!k) { pSt('API Key eingeben!', 'idle'); return; }
  st('dc_k', k);
  st('dc_l', $sLang.value);
  applySettingsView(false);
  pSt('\u2713 Gespeichert!', 'ok');
  setTimeout(function() { if (!recording && !busy) pSt('Tap = Aufnahme', 'idle'); }, 1500);
});
```

- [ ] **Step 5: Add recording logic (startR, stopR, tick, transcribe)**

Same logic as desktop, adapted:
- No PiP window references
- `transcribe()` sets status to "Fertig — Kopieren tippen" instead of auto-copying
- Copy button gets enabled after transcription

```js
function toggle() { if (busy) return; recording ? stopR() : startR(); }

function startR() {
  var k = ld('dc_k', '').trim();
  if (!k) { pSt('API Key fehlt — ⚙', 'idle'); return; }
  function go(stream) {
    micStream = stream;
    var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
      MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    chunks = [];
    mediaRec.ondataavailable = function(e) { if (e.data.size) chunks.push(e.data); };
    mediaRec.onstop = transcribe;
    mediaRec.start(1000);
    recStart = Date.now();
    recording = true;
    updBtn();
    tick();
  }
  if (micStream && micStream.getTracks().some(function(t) { return t.readyState === 'live'; })) {
    go(micStream);
  } else {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(go).catch(function() {
      pSt('Mikrofon-Zugriff verweigert', 'idle');
    });
  }
}

function stopR() {
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  recording = false;
  busy = true;
  updBtn();
}

function tick() {
  if (!recording) return;
  var s = Math.floor((Date.now() - recStart) / 1000);
  pSt('REC ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'), 'rec');
  setTimeout(tick, 500);
}

function transcribe() {
  pSt('Transkribiert\u2026', 'idle');
  var dur = (Date.now() - recStart) / 60000;
  var k = ld('dc_k', '').trim(), lang = ld('dc_l', 'de');
  var ext = (chunks[0] && chunks[0].type && chunks[0].type.indexOf('mp4') >= 0) ? 'mp4' : 'webm';
  var blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' });
  var fd = new FormData();
  fd.append('file', blob, 'audio.' + ext);
  fd.append('model', 'whisper-1');
  fd.append('language', lang);

  fetch(WHISPER, { method: 'POST', headers: { 'Authorization': 'Bearer ' + k }, body: fd })
    .then(function(r) {
      if (!r.ok) return r.json().catch(function() { return {}; }).then(function(e) {
        throw new Error((e.error && e.error.message) || ('HTTP ' + r.status));
      });
      return r.json();
    })
    .then(function(d) {
      lastTxt = d.text || '';
      $out.value = lastTxt;
      var cost = dur * CPM;
      sessCost += cost;
      var cs = ldC(), tk = tKey();
      cs[tk] = (cs[tk] || 0) + cost;
      cs._t = (cs._t || 0) + cost;
      svC(cs);
      renderCosts();
      if (lastTxt.trim()) {
        $cpBtn.disabled = false;
        pSt('Fertig \u2014 Kopieren tippen', 'ok');
        flash();
      } else {
        pSt('(leere Antwort)', 'idle');
      }
    })
    .catch(function(e) { pSt('Fehler: ' + (e.message || e).toString().slice(0, 40), 'idle'); })
    .then(function() { busy = false; updBtn(); });
}
```

- [ ] **Step 6: Add UI helpers (pSt, updBtn, renderCosts, flash)**

```js
function pSt(m, mode) {
  $status.textContent = m;
  $dot.className = 'dot ' + (mode || 'idle');
}

function updBtn() {
  while ($recBtn.firstChild) $recBtn.removeChild($recBtn.firstChild);
  if (recording) $recBtn.appendChild(svgIcon(ICO_STOP, 22));
  else if (busy) $recBtn.appendChild(svgIcon(ICO_WAIT, 22));
  else $recBtn.appendChild(svgIcon(ICO_MIC, 28));
  $recBtn.className = 'rb' + (recording ? ' on' : busy ? ' busy' : '');
  $ring.className = 'rb-ring' + (recording ? ' on' : '');
  $wave.className = 'wave' + (recording ? ' on' : '');
  if (!recording && !busy) pSt('Tap = Aufnahme', 'idle');
}

function renderCosts() {
  var c = ldC(), f = function(v) { return '$' + v.toFixed(3); };
  $cS.textContent = f(sessCost);
  $cT.textContent = f(c[tKey()] || 0);
  $cA.textContent = f(c._t || 0);
}

function flash() {
  $out.classList.add('fl');
  setTimeout(function() { $out.classList.remove('fl'); }, 2000);
}
```

- [ ] **Step 7: Add button event listeners (record, copy, clear, reset)**

```js
$recBtn.addEventListener('click', toggle);

$cpBtn.addEventListener('click', function() {
  if (!lastTxt) return;
  navigator.clipboard.writeText(lastTxt).then(function() {
    pSt('\u2713 Im Clipboard!', 'ok');
    flash();
  }).catch(function() {
    pSt('Kopieren fehlgeschlagen', 'idle');
  });
});

$clBtn.addEventListener('click', function() {
  lastTxt = '';
  $out.value = '';
  $cpBtn.disabled = true;
  pSt('Tap = Aufnahme', 'idle');
});

$rsBtn.addEventListener('click', function() {
  sessCost = 0;
  try { localStorage.removeItem('dc_c'); } catch(e) {}
  renderCosts();
  pSt('Kosten zurückgesetzt', 'ok');
  setTimeout(function() { if (!recording && !busy) pSt('Tap = Aufnahme', 'idle'); }, 1500);
});
```

- [ ] **Step 8: Add service worker registration + MediaRecorder check**

```js
// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function() {});
}

// MediaRecorder check
if (typeof MediaRecorder === 'undefined') {
  pSt('MediaRecorder nicht verfügbar — iOS 14.3+ nötig', 'idle');
  $recBtn.disabled = true;
  $recBtn.className = 'rb busy';
}
```

- [ ] **Step 9: Verify full functionality**

Open `dictate-mobile.html` in Chrome (mobile emulation) or on an actual iPhone via a local HTTPS server. Check:
- Settings panel shows on first launch (no API key)
- After saving key, textarea appears
- Record → Stop → transcription appears
- Copy button works (text in clipboard)
- Costs update correctly
- Gear toggles settings
- Clear button works
- Costs reset works
- Waveform animation plays during recording
- Status dot changes color appropriately

- [ ] **Step 10: Commit**

```bash
git add dictate-mobile.html
git commit -m "feat: add complete mobile PWA with recording, transcription, and copy flow"
```

---

### Task 4: Update README + Push + Verify GitHub Pages

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README with mobile section**

Add a "Mobile (iOS)" section to the README explaining how to install the PWA:

```markdown
## Mobile (iOS)

1. Open `https://mfsh3.github.io/dictate/dictate-mobile.html` in Safari
2. Tap Share → "Add to Home Screen"
3. Open the app, enter your API key
4. Tap the record button → speak → tap stop
5. Tap "Kopieren" → switch to target app → paste
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "docs: add mobile PWA installation instructions"
git push origin main
```

- [ ] **Step 3: Verify GitHub Pages**

Wait 1-2 minutes, then check:
- `https://mfsh3.github.io/dictate/dictate-mobile.html` loads
- `https://mfsh3.github.io/dictate/manifest.json` returns valid JSON
- `https://mfsh3.github.io/dictate/sw.js` returns JS
- On iPhone Safari: can add to home screen
