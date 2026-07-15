# 🎧 Audiobook Reader

Turns your documents into an audiobook. Drop in a **PDF, Word file, text file, or Markdown**, press play, and the voices already built into your phone or computer read it aloud.

**→ [Open the app](https://iffrit-coder.github.io/audiobook-reader/)**

Free. No account, no ads, no tracking. Install it once and it works offline forever.

---

## Your documents never leave your device

This is the entire point of the project, so it's worth being precise:

- **No server, no account, no upload.** Your file is opened, parsed, and spoken entirely inside your browser. It is never transmitted anywhere.
- **The browser enforces it — it isn't just a promise.** The page ships a Content-Security-Policy containing `connect-src 'none'`, which blocks *every* outbound network request the page is capable of making. Even if the code tried to send your file somewhere, the browser would refuse.
- **No third-party code, no analytics.** The PDF and Word parsers ([pdf.js](https://mozilla.github.io/pdf.js/), [mammoth.js](https://github.com/mwilliamson/mammoth.js)) are bundled in this repo under `vendor/`. Nothing is fetched from a CDN at runtime.
- **It works offline.** After the first visit, the whole app is cached on your device. Turn on Airplane Mode and it still reads your books — the simplest proof that nothing is leaving.

The one thing that does touch the network is **downloading the app itself the first time you open it** — whoever hosts it (GitHub, by default) sees that request, exactly like any other website. Your documents are never part of it. After that, you can stay offline permanently.

Don't want to trust the hosted copy? [Host your own](#self-hosting) — it's just static files.

## Install it like a real app

| Platform | How |
|---|---|
| **iPhone / iPad** | Open in Safari → Share → **Add to Home Screen** |
| **Android** | Chrome menu → **Install app** |
| **Mac / Windows** | Chrome or Edge → install icon in the address bar |

## What it does

- **Reads PDF, DOCX, TXT, and Markdown** (legacy `.doc` isn't supported — re-save as `.docx`).
- **Understands document structure.** Titles and subtitles are detected and read with proportional pauses instead of being run together with the body text.
- **Strips PDF clutter.** Repeated running headers, footers, download stamps, and page numbers are detected and skipped, so you don't hear "Downloaded on 3 March 2026" once per page.
- **Speaks mathematical notation.** `<` becomes "less than", `x^2` becomes "x squared", plus Greek letters, fractions, sub/superscripts, and more.
- **Click any sentence** to start reading from there. <kbd>Space</kbd> plays/pauses.
- **Remembers your book.** The last document you opened and how far you got are saved on your device, so it's waiting for you next time.
- **Remembers your voice**, speed, and pitch.
- **Lock-screen and headphone controls**, and it keeps the screen awake while reading.

## Getting better voices

The app uses the voices your operating system already has, so voice quality is set by your OS, not by this app.

- **iPhone / iPad** — Settings → Accessibility → Spoken Content → Voices → English, and download one marked **Enhanced** or **Premium**.
- **macOS** — System Settings → Accessibility → Spoken Content → Manage Voices. Note that **Safari only exposes a limited set of voices without the enhanced ones**; Chromium browsers (Chrome, Edge, Comet) expose the full system list. Use one of those for the good voices.

## Known limitations

- **Speech stops when an iPhone locks or the app is backgrounded.** This is an Apple restriction on browser text-to-speech, and no web app can work around it. The app keeps the screen awake while reading to make hands-free listening work; true locked-screen playback would require a native app.
- **iOS may not expose Enhanced voices to web apps at all**, regardless of browser — every iOS browser shares the same speech engine.
- **Scanned/image-only PDFs have no text layer** to read. There's no OCR.
- The ring/silent switch can mute playback on iPhone.

## Self-hosting

It's a static site with no build step:

```bash
git clone https://github.com/Iffrit-coder/audiobook-reader.git
cd audiobook-reader
python3 -m http.server 8000
# open http://localhost:8000
```

To publish your own copy: fork the repo, then in **Settings → Pages** set the source to the `main` branch, `/` root. That's it.

A secure context (`https://` or `localhost`) is required — service workers and the speech API need one.

## How it's built

Plain HTML, CSS, and JavaScript in a single `index.html`. No framework, no build tooling, no dependencies to install.

| File | Purpose |
|---|---|
| `index.html` | The whole app — UI, parsers, speech engine |
| `service-worker.js` | Offline cache (bump `CACHE_VERSION` when assets change) |
| `manifest.webmanifest` | Makes it installable |
| `vendor/` | Bundled pdf.js + mammoth.js |

## License

[MIT](LICENSE) — do what you like with it.
