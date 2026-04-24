# Pocket Card

A one-page, installable pocket card for the storm-brain. Dark sky, quiet typography, a slow thunderstorm behind the text. Open it when the alarm goes off and you need a moment to set it down.

**Live site → [stewalexander-com.github.io/pocket-card](https://stewalexander-com.github.io/pocket-card/)**

<p align="center">
  <img src="docs/hero-top.jpg" alt="Pocket Card hero screenshot — bright white mantra over a dark thunderstorm" width="360"/>
</p>

— *Accipio. Ludo.*
*— I accept what is, and I play anyway.*

---

## What it is

Pocket Card is a single HTML page that reads like a letter to yourself.

- A short **mantra** you can hold onto.
- A numbered list for **when the storm-brain fires** — name it, ask for evidence, choose, log.
- A few simple **CBT moves** in the same voice — cognitive defusion ("a thought, not a fact"), decatastrophizing ("worst case · likely case · best case"), the double log ("one good thing · one thing I handled"), relabeling, and 5-senses grounding ("name five things you can see").
- A **box-breathing diagram** (4 in · 4 hold · 6 out) with a glowing dot that rides the edges so you can pace your breath.
- An italic-serif footer — *Breathe · Name · Choose · Log* — that scrolls you to the matching section, with a slow gold shimmer on **Log** because it's the only action that writes anything to the device.
- A nightly **Tonight** reflection prompt.
- An ambient **thunderstorm video + audio** loop (seamless, 7 s, audio off by default — tap the speaker icon bottom-right to enable).

No tracking. No accounts. No network calls after the first load. Everything is cached by a service worker so it works fully offline.

## The Log

Tapping **Log** in the footer opens [`/log/`](https://stewalexander-com.github.io/pocket-card/log/) — a private, on-device journal designed in the same dark, quiet voice as the card.

- A dramatic **date hero** (weekday · gold-gradient day numeral · italic month-year) and one editable entry per day.
- **Autosave** with a 350 ms debounce. Past days are read-only with their own delete button.
- **Immutable by default** — clearing today's textarea does *not* delete the entry. Only the explicit × on a history row can remove anything.
- **Export .txt** — emit the whole log as a portable text file with a long-dash divider between days.
- **Import .txt** — read a Pocket Card export back in. Same-day conflicts append the imported text *below* the device text with a divider; new days are added verbatim. A toast summarizes (`N added · N merged · N skipped`).
- **Resilience** — every successful save also writes a shadow backup key. On parse failure the reader refuses to silently return empty and falls back to the last good snapshot. `navigator.storage.persist()` is requested so the browser won't evict the log under storage pressure.
- **Strict CSP** (`default-src 'self'` + Google Fonts only), no analytics, no network calls.

Storage keys (localStorage, this origin only):

- `pocketcard.log.v1` — primary entries (`{ "YYYY-MM-DD": { text, updated } }`)
- `pocketcard.log.v1.backup` — shadow snapshot of the last known-good blob
- `pocketcard.audio` — audio on/off preference for the card

To reset everything: **Erase all** (with confirm) clears both keys.

## Install it as a PWA

Pocket Card is a Progressive Web App — it installs to your home screen like a native app, runs full-screen, and works offline.

### iPhone / iPad (Safari)

1. Open [stewalexander-com.github.io/pocket-card](https://stewalexander-com.github.io/pocket-card/) in **Safari** (not Chrome — iOS only lets Safari install PWAs).
2. Tap the **Share** button at the bottom of the screen ( the square with the up-arrow ).
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name (“Pocket”) and tap **Add**.
5. Launch it from your home screen. It opens full-screen with no browser chrome. The storm and audio work offline after the first load.

> A small in-app hint box will also appear on iOS Safari to guide you through this.

### Android (Chrome, Edge, Samsung Internet)

1. Open the site in Chrome.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**).
3. Confirm. The app installs and appears in your launcher.

### macOS / Windows / Linux (Chrome, Edge, Brave)

1. Open the site.
2. Click the **install icon** in the address bar (looks like a monitor with a down-arrow) — or **⋮ menu → Install Pocket Card**.
3. The app opens in its own window and can be pinned to the Dock / Taskbar.

> **Updating an installed PWA:** when a new version ships, pull-to-refresh once on Android/desktop, or twice on iOS Safari, to pick up the new service worker. The first refresh swaps the worker; the second serves the new files.

## How it's built

- **Two HTML pages**, no framework, no build step. Tailwind-free, React-free, on purpose.
  - `index.html` — the card itself.
  - `log/index.html` + `log/log.js` — the on-device log (script externalized to satisfy strict CSP).
- **Google Fonts**: Coda Caption, Days One, Hammersmith One, Cormorant Garamond, Inter.
- **Procedural thunderstorm video**: [`_build/render-storm.js`](_build/render-storm.js) renders 168 frames of a 7-second seamless loop through a headless Chromium canvas, then [ffmpeg](https://ffmpeg.org) encodes mobile (720×1280) and desktop (1080×1920) H.264 MP4s. The noise is periodic (cosine-smoothed FBM) so frame 0 == frame 168 perfectly — no loop seam.
- **iOS audio unlock**: a silent MP3 primes the audio context on first user gesture; full thunder audio starts when the user taps the speaker toggle. Logic borrowed from [Rain View](https://github.com/StewAlexander-com/rain-view).
- **Service worker** (`sw.js`): cache-first with network revalidation, per-URL cache keys, scope covers `/log/`. Version bumped per release so installed PWAs pick up updates on next launch.
- **Icons**: SVG + maskable PNGs (192/512/apple-touch) pre-rendered via CairoSVG.

## Rebuild the storm video

Requires Node.js (for Playwright) and ffmpeg.

```bash
cd _build
npm i playwright
npx playwright install chromium

# Mobile frames (720×1280)
STORM_W=720 STORM_H=1280 node render-storm.js

# Encode mobile MP4
ffmpeg -y -framerate 24 -i /tmp/storm-frames/%04d.png \
  -vf "scale=720:1280:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.0 \
  -preset slow -crf 28 -tune stillimage -movflags +faststart \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -an ../assets/storm-mobile.mp4

# Desktop frames (1080×1920)
STORM_W=1080 STORM_H=1920 node render-storm.js

# Encode desktop MP4
ffmpeg -y -framerate 24 -i /tmp/storm-frames/%04d.png \
  -vf "scale=1080:1920:flags=lanczos" \
  -c:v libx264 -pix_fmt yuv420p -profile:v high -level 4.1 \
  -preset slow -crf 25 -tune stillimage -movflags +faststart \
  -g 48 -keyint_min 48 -sc_threshold 0 \
  -an ../assets/storm-desktop.mp4
```

## Run locally

```bash
python3 -m http.server 8787
# open http://localhost:8787
```

A real server is required (not `file://`) because service workers need HTTPS or `localhost`.

## Privacy

- **No accounts. No tracking. No analytics.** No third-party scripts of any kind.
- The only network requests are to Google Fonts (the first time you load the page) and same-origin assets. After install, everything is cached and the app works fully offline.
- The log is stored in your browser's `localStorage` for **this origin only**. It never leaves the device unless *you* tap **Export .txt**.
- Strict Content-Security-Policy on the log page restricts script and connection sources to `'self'`.

## Releases

Versions are tagged in this repo. The service-worker `CACHE_NAME` is bumped on every shipping change so installed PWAs pick up the update on next launch.

| Version | Highlights |
|---|---|
| **v1.0.0** | First stable release. Mantra + storm-brain list with CBT moves, box-breathing diagram, italic-serif footer with shimmer on *Log*, full on-device log (autosave, immutable entries, import/export `.txt`, shadow-backup recovery, persistent storage request). |

## Credits

- Thunderstorm ambience: see [`AUDIO-CREDITS.txt`](AUDIO-CREDITS.txt).
- Video loop technique: adapted from [Rain View](https://github.com/StewAlexander-com/rain-view).
- The words belong to the person who needs them.

---

— *Accipio. Ludo.* —

*I've got it from here.*
