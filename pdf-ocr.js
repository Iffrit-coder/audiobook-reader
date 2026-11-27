/*
 * pdf-ocr.js — on-device text recognition for scanned PDF pages.
 *
 * Uses Tesseract (tesseract.js), bundled under vendor/tesseract/ and loaded only
 * when a PDF has pages that are pictures with no text layer. Nothing is sent
 * anywhere: the page is drawn to a canvas here and recognized by a worker
 * running from this site's own files.
 *
 * Exposes window.PdfOcr.recognize(pdf, pageNumbers, langs, onProgress)
 *   → { [pageNumber]: text }
 */
(function () {
  "use strict";
  // Absolute URLs: the worker resolves relative paths against its own location.
  const BASE = new URL("vendor/tesseract/", document.baseURI).href;
  const LANGS = { eng: "English", spa: "Español", heb: "עברית" };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const el = document.createElement("script");
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("Couldn't load the text-recognition engine."));
      document.head.appendChild(el);
    });
  }

  // WebAssembly SIMD makes recognition roughly twice as fast where available.
  function simdSupported() {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3,
        2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (_) { return false; }
  }

  async function renderPage(pdf, p) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    // ~2000px across is plenty for body text and keeps memory reasonable on phones.
    const scale = Math.min(4, Math.max(1.5, 2000 / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return canvas;
  }

  async function recognize(pdf, pages, langs, onProgress) {
    await loadScript(BASE + "tesseract.min.js");
    let current = 0, pageShare = 0;
    const report = (frac) => onProgress && onProgress(current, pages.length, frac);
    const worker = await Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, {
      workerPath: BASE + "worker.min.js",
      corePath: BASE + (simdSupported() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js"),
      langPath: BASE + "lang",
      gzip: true,
      // Start the worker from its own file rather than a blob: URL, so it can
      // read the bundled language files (same-origin only; see README).
      workerBlobURL: false,
      logger: (m) => { if (m.status === "recognizing text") report(m.progress); },
      errorHandler: () => {},
    });
    const out = {};
    try {
      for (let i = 0; i < pages.length; i++) {
        current = i + 1;
        report(0);
        const canvas = await renderPage(pdf, pages[i]);
        const { data } = await worker.recognize(canvas);
        out[pages[i]] = data.text || "";
        canvas.width = canvas.height = 0; // free the bitmap
      }
    } finally {
      await worker.terminate();
    }
    return out;
  }

  window.PdfOcr = { recognize, LANGS };
})();
