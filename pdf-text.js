/*
 * pdf-text.js — turns pdf.js text items into clean, speakable text.
 *
 * pdf.js hands back a page as a list of "text items": runs of glyphs with a
 * position, a width and a font size. How a PDF splits its text into items is up
 * to whatever program made it — one item per line, per word, per font change,
 * or even per letter — so joining items blindly produces "Th is" and
 * "wonder ful", or glues two columns together. Everything here works from the
 * glyph geometry instead:
 *
 *   - items are joined with a space only when there is a real gap between them
 *   - lines are detected from the baseline, not only from pdf.js' hasEOL flag
 *   - side-by-side columns are read one column at a time
 *   - words hyphenated across a line break are rejoined
 *   - ligatures (ﬁ, ﬂ, …), soft hyphens, zero-width and odd space characters
 *     are normalised so the speech engine doesn't trip over them
 *   - sentences are not split after abbreviations like "Dr." or "e.g."
 *
 * No DOM access: runs in the browser (window.PdfText) and in Node for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfText = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- Character clean-up ----------
  const LIGATURES = {
    "\uFB00": "ff", "\uFB01": "fi", "\uFB02": "fl", "\uFB03": "ffi", "\uFB04": "ffl",
    "\uFB05": "st", "\uFB06": "st", "\u0132": "IJ", "\u0133": "ij", "\u0152": "OE",
    "\u0153": "oe", "\uA732": "AA", "\uA733": "aa",
  };
  const LIGATURE_RX = /[\uFB00-\uFB06\u0132\u0133\uA732\uA733]/g;

  // Only targeted replacements: full NFKC would also turn ½ into "1⁄2" and
  // ² into "2", which the speech layer reads better as symbols.
  function cleanText(s) {
    if (!s) return "";
    return s
      .replace(LIGATURE_RX, (c) => LIGATURES[c] || c)
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")                // zero-width chars
      .replace(/\u00AD(?!\s*$)/g, "")                             // soft hyphens (a line-final one marks a split word; joinLines uses it)
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ") // exotic spaces
      .replace(/[\u2010\u2011]/g, "-")                             // typographic hyphens
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ") // stray control chars
      .replace(/\uFFFD/g, "");                                      // unmappable glyphs
  }

  const isBlank = (s) => !s || !/\S/.test(s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, ""));

  // ---------- Geometry ----------
  // Express each item in its own baseline frame so rotated pages work too:
  // `along` runs with the text, `perp` is the baseline height.
  function geom(it) {
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.hypot(t[2], t[3]) || it.height || Math.hypot(t[0], t[1]) || 0;
    const ang = Math.atan2(t[1], t[0]);
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const x = t[4], y = t[5];
    const along = x * cos + y * sin;
    const perp = -x * sin + y * cos;
    const w = it.width || 0;
    return { size, along, perp, start: along, end: along + w };
  }

  // Distance between two intervals along the baseline (0 when they touch or
  // overlap). Works whichever way the text runs, so RTL needs no special case.
  const intervalGap = (a1, a2, b1, b2) => Math.max(a1, b1) - Math.min(a2, b2);

  // A space is inserted between two items only when the gap between them is
  // at least this fraction of the font size. Kerning and letter-spacing gaps
  // are far smaller; a real word space is ~0.25em.
  const SPACE_GAP = 0.15;
  // A gap wider than this (in em) splits a line into separate segments, so
  // side-by-side columns can be told apart.
  const SEGMENT_GAP = 2.0;
  // Baseline change (in em) that starts a new line.
  const LINE_SHIFT = 0.6;

  /**
   * Group a page's text items into segments: runs of text on one baseline
   * with no wide gap inside. Returns [{ text, size, perp, start, end, lineNo, dir }].
   */
  function itemsToSegments(items) {
    const segs = [];
    let seg = null, lineNo = 0, pendingSpace = false, lastEOL = false;

    const close = () => {
      if (seg) {
        seg.text = seg.text.replace(/\s+/g, " ").trim();
        if (seg.text) segs.push(seg);
      }
      seg = null;
    };

    for (const it of items) {
      const str = it.str || "";
      if (isBlank(str)) {
        if (str) pendingSpace = true;
        if (it.hasEOL) { close(); lineNo++; pendingSpace = false; lastEOL = true; }
        continue;
      }
      const g = geom(it);
      const size = g.size || (seg && seg.size) || 10;

      let newLine = lastEOL;
      let newSeg = false;
      if (seg && !newLine) {
        const ref = Math.max(size, seg.size) || size;
        if (Math.abs(g.perp - seg.perp) > LINE_SHIFT * ref) newLine = true;
        else {
          const gap = intervalGap(seg.start, seg.end, g.start, g.end);
          if (gap > SEGMENT_GAP * ref) newSeg = true;
          else {
            const needSpace = pendingSpace || /\s$/.test(seg.text) || /^\s/.test(str) ||
              gap > SPACE_GAP * Math.min(size, seg.size || size);
            seg.text += (needSpace ? " " : "") + str;
            seg.start = Math.min(seg.start, g.start);
            seg.end = Math.max(seg.end, g.end);
            seg.size = Math.max(seg.size, size);
            if (it.dir === "rtl") seg.rtl++;
            seg.chars += str.length;
          }
        }
      }
      if (!seg || newLine || newSeg) {
        if (newLine && seg) lineNo++;
        close();
        seg = { text: str, size, perp: g.perp, start: g.start, end: g.end, lineNo,
                rtl: it.dir === "rtl" ? 1 : 0, chars: str.length };
      }
      pendingSpace = false;
      lastEOL = false;
      if (it.hasEOL) { close(); lineNo++; lastEOL = true; }
    }
    close();
    return segs;
  }

  /**
   * Find a vertical gutter that splits the page into two side-by-side
   * columns. Returns the gutter's position along the baseline, or null.
   */
  function findGutter(segs) {
    const byLine = new Map();
    segs.forEach((s) => { (byLine.get(s.lineNo) || byLine.set(s.lineNo, []).get(s.lineNo)).push(s); });
    // Starts of segments that sit to the right of another segment on the same line.
    const starts = [];
    for (const line of byLine.values()) {
      if (line.length < 2) continue;
      const sorted = line.slice().sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) starts.push({ x: sorted[i].start, size: sorted[i].size });
    }
    if (starts.length < 2) return null;
    // Cluster those starts; a column edge is a start shared by several lines.
    starts.sort((a, b) => a.x - b.x);
    let best = null;
    for (let i = 0; i < starts.length; i++) {
      const tol = starts[i].size * 0.75;
      let n = 0;
      for (let j = i; j < starts.length && starts[j].x - starts[i].x <= tol; j++) n++;
      if (!best || n > best.n) best = { x: starts[i].x, n };
    }
    if (!best || best.n < 2) return null;
    const g = best.x - 0.01;
    let left = 0, right = 0, cross = 0, leftN = 0, rightN = 0;
    for (const s of segs) {
      if (s.end <= g + s.size * 0.25) { left += s.chars; leftN++; }
      else if (s.start >= g) { right += s.chars; rightN++; }
      else cross += s.chars;
    }
    const total = left + right + cross;
    // Both sides must hold real running text (not a column of page numbers),
    // and little may straddle the gutter.
    if (!leftN || !rightN) return null;
    if (left / leftN < 12 || right / rightN < 12) return null;
    if (Math.min(left, right) < total * 0.2) return null;
    if (cross > total * 0.25) return null;
    return g;
  }

  /**
   * Turn one page's text items into reading-order lines:
   * [{ text, size, page, perp }]. Two-column layouts are read column by column.
   */
  function pageItemsToLines(items, page) {
    const segs = itemsToSegments(items);
    if (!segs.length) return [];
    const rtl = segs.reduce((a, s) => a + s.rtl, 0) > segs.reduce((a, s) => a + s.chars, 0) / 4;

    const gutter = findGutter(segs);
    let ordered;
    if (gutter == null) {
      // Single column: segments that share a line are joined back together.
      ordered = [];
      let cur = null;
      for (const s of segs) {
        if (cur && cur.lineNo === s.lineNo) {
          cur.text += " " + s.text;
          cur.size = Math.max(cur.size, s.size);
        } else {
          cur = { ...s };
          ordered.push(cur);
        }
      }
    } else {
      // Two columns. A line that straddles the gutter (a title, a full-width
      // figure caption) ends the current band of columns.
      ordered = [];
      let left = [], right = [];
      const flushBand = () => {
        const first = rtl ? right : left, second = rtl ? left : right;
        ordered.push(...first, ...second);
        left = []; right = [];
      };
      for (const s of segs) {
        if (s.end <= gutter + s.size * 0.25) left.push(s);
        else if (s.start >= gutter) right.push(s);
        else { flushBand(); ordered.push(s); }
      }
      flushBand();
    }
    return ordered.map((s) => ({ text: cleanText(s.text).replace(/\s+/g, " ").trim(), size: Math.round(s.size), page, perp: s.perp }))
      .filter((l) => l.text);
  }

  // ---------- Joining lines into paragraphs ----------
  // A line ending in a hyphenated word fragment followed by a line starting
  // lower-case is a word broken across the line: "exam-" + "ple" → "example".
  const HYPH_END = /(\p{L})[-\u00AD\u2010]$/u;
  function joinLines(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (/\u00AD$/.test(a)) return a.slice(0, -1) + b;
    if (HYPH_END.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
    return a + " " + b;
  }

  /**
   * lines: [{ text, size, page, perp?, ocr?, paraStart? }] in reading order.
   * Returns blocks [{ type: 'title'|'subtitle'|'text', text }].
   */
  function linesToBlocks(rawLines, numPages) {
    // pageItemsToLines already cleaned its lines; OCR lines haven't been.
    const lines = rawLines.map((l) => ({ ...l, text: cleanText(l.text).replace(/\s+/g, " ").trim() }))
      .filter((l) => l.text);

    // Body font size = the size that covers the most characters.
    const tally = {};
    lines.forEach((l) => { if (!l.ocr && l.size) tally[l.size] = (tally[l.size] || 0) + l.text.length; });
    let body = 0, most = -1;
    for (const s in tally) if (tally[s] > most) { most = tally[s]; body = +s; }

    // ---- Repeated running headers / footers / download stamps ----
    // Normalize so page numbers and dates don't defeat matching across pages.
    const norm = (t) => t.toLowerCase().replace(/\d+/g, " ").replace(/[^\p{L} ]+/gu, " ").replace(/\s+/g, " ").trim();
    const SOURCE_RX = /(download|gutenberg|e-?book|copyright|©|retriev|accessed|https?|www\.|all rights reserved|licen[sc]e)/i;
    const stats = {};
    lines.forEach((l) => {
      const n = norm(l.text);
      if (n.length < 4) return;
      const s = stats[n] || (stats[n] = { pages: new Set(), minSize: Infinity });
      s.pages.add(l.page);
      s.minSize = Math.min(s.minSize, l.size || Infinity);
    });
    const threshold = Math.max(3, Math.ceil(numPages * 0.4));
    const boilerplate = new Set(Object.keys(stats).filter((n) => {
      const s = stats[n];
      if (s.pages.size < threshold) return false;
      return (body && s.minSize < body) || SOURCE_RX.test(n);
    }));
    const isPageNumber = (t) => /^[\s.\-\u2013\u2014|]*(?:page\s*|p\.\s*)?\d{1,4}[\s.\-\u2013\u2014|]*$/i.test(t) ||
      /^[\s.\-\u2013\u2014|]*(?:page\s*)?\d{1,4}\s*(?:of|\/)\s*\d{1,4}[\s.\-\u2013\u2014|]*$/i.test(t);

    const classify = (l) => {
      if (l.ocr || !body || !l.size) return "text";
      if (l.size >= body * 1.45) return "title";
      if (l.size >= body * 1.15) return "subtitle";
      return "text";
    };

    const blocks = [];
    let para = "", prev = null;
    const flushPara = () => { if (para) { blocks.push({ type: "text", text: para.replace(/\u00AD$/, "") }); para = ""; } };
    for (const l of lines) {
      if (isPageNumber(l.text) || boilerplate.has(norm(l.text))) continue;
      const t = classify(l);
      if (t === "text") {
        // Paragraph break: OCR said so, or a clearly larger gap than a line step.
        const gapBreak = prev && prev.type === "text" && prev.page === l.page &&
          prev.perp != null && l.perp != null && (prev.perp - l.perp) > 1.9 * Math.max(prev.size || 0, l.size || 0, 1);
        if (l.paraStart || gapBreak) flushPara();
        para = joinLines(para, l.text);
      } else {
        flushPara();
        const last = blocks[blocks.length - 1];
        // A heading that wraps onto a second line stays one heading.
        if (last && prev && last.type === t && prev.type === t && prev.page === l.page &&
            prev.size === l.size && prev.perp != null && l.perp != null &&
            (prev.perp - l.perp) < 1.6 * l.size) {
          last.text = joinLines(last.text, l.text);
        } else blocks.push({ type: t, text: l.text.replace(/\u00AD$/, "") });
      }
      prev = { type: t, page: l.page, perp: l.perp, size: l.size };
    }
    flushPara();
    return blocks;
  }

  // ---------- Sentence splitting ----------
  // Loss-less: the pieces concatenate back to the (whitespace-collapsed) input.
  // Splits on . ! ? followed by whitespace, except after common abbreviations,
  // single-letter initials, or when the next word starts lower-case.
  const ABBREV = new Set((
    "mr mrs ms mx dr prof sr sra srta jr st mt ft vs etc al cf eg ie viz approx " +
    "dept est fig figs no nos vol vols pp p ed eds rev inc ltd co corp gen gov sen rep " +
    "lt col capt sgt jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri " +
    "sat sun ud uds dra lic ing arq pág pag núm num cap tel av avda ph mba bsc msc " +
    "u.s u.k u.n e.g i.e a.m p.m ph.d"
  ).split(/\s+/));

  function splitSentences(text) {
    text = (text || "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    const out = [];
    // Western . ! ? … need a following space; CJK 。！？ end a sentence on their own.
    const re = /[.!?\u2026]+["'\u201D\u2019)\]]*(?=\s|$)|[\u3002\uFF01\uFF1F]+[\u300D\u300F\u201D\uFF09]*/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      const end = m.index + m[0].length;
      const rest = text.slice(end).trimStart();
      if (m[0][0] === "." && m[0].replace(/["'\u201D\u2019)\]]+$/, "") === "." && rest) {
        const before = text.slice(last, m.index);
        const word = (before.match(/([\p{L}.]+)$/u) || [""])[0].toLowerCase();
        const next = rest[0];
        if (ABBREV.has(word) || /^\p{L}$/u.test(word) || /^\p{Ll}/u.test(next) || /^\d/.test(next) && /^(no|nos|p|pp|vol|fig|figs|núm|num|pág|pag)$/.test(word)) {
          continue;
        }
      }
      out.push(text.slice(last, end).trim());
      last = end;
    }
    if (last < text.length) out.push(text.slice(last).trim());
    return out.filter(Boolean);
  }

  // ---------- OCR output ----------
  // Tesseract returns plain text: lines separated by \n, paragraphs by blank
  // lines. Convert to the same line records the PDF path produces.
  function ocrTextToLines(text, page) {
    const lines = [];
    String(text || "").replace(/\r/g, "").split(/\n\s*\n/).forEach((para) => {
      let first = true;
      para.split("\n").forEach((ln) => {
        const t = ln.replace(/\s+/g, " ").trim();
        if (!t) return;
        lines.push({ text: t, size: 0, page, ocr: true, paraStart: first });
        first = false;
      });
    });
    return lines;
  }

  // ---------- Bundled CMaps (CJK and other predefined-encoding fonts) ----------
  // pdf.js normally fetch()es CMap files, which the page's CSP forbids. This
  // factory serves them from a bundle loaded like any other same-origin script.
  const CMAP_BINARY = 1; // pdfjsLib.CMapCompressionType.BINARY
  function base64ToBytes(b64) {
    if (typeof atob === "function") {
      const bin = atob(b64), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  function makeCMapReaderFactory(loadBundle) {
    let bundle = null;
    return class BundledCMapReaderFactory {
      constructor() {}
      async fetch({ name }) {
        if (!bundle) bundle = Promise.resolve(loadBundle());
        const map = await bundle;
        const b64 = map && map[name];
        if (!b64) throw new Error(`The font encoding "${name}" isn't bundled.`);
        return { cMapData: base64ToBytes(b64), compressionType: CMAP_BINARY };
      }
    };
  }

  // ---------- Whole-document pass ----------
  /**
   * Read every page of an open pdf.js document.
   * Returns { lines, imagePages, failedPages }:
   *   imagePages — pages with no text layer but with pictures (scanned pages, OCR candidates)
   *   failedPages — pages pdf.js couldn't read at all (skipped, not fatal)
   * opts.ops: pdfjsLib.OPS, used to spot pages that are only pictures.
   */
  async function extractDocument(pdf, opts = {}) {
    const lines = [], imagePages = [], failedPages = [];
    const imageOps = opts.ops ? new Set([opts.ops.paintImageXObject, opts.ops.paintInlineImageXObject,
      opts.ops.paintImageXObjectRepeat, opts.ops.paintJpegXObject, opts.ops.paintImageMaskXObject].filter((x) => x != null)) : null;
    for (let p = 1; p <= pdf.numPages; p++) {
      if (opts.onProgress) opts.onProgress(p, pdf.numPages);
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const pageLines = pageItemsToLines(content.items, p);
        const chars = pageLines.reduce((a, l) => a + l.text.replace(/\W/g, "").length, 0);
        if (chars < 3 && imageOps) {
          try {
            const ol = await page.getOperatorList();
            if (ol.fnArray.some((fn) => imageOps.has(fn))) imagePages.push(p);
          } catch (_) { /* can't tell; treat as blank */ }
        }
        lines.push(...pageLines);
        if (page.cleanup) page.cleanup();
      } catch (err) {
        failedPages.push(p);
      }
    }
    return { lines, imagePages, failedPages };
  }

  return {
    extractDocument, cleanText, itemsToSegments, findGutter, pageItemsToLines, joinLines,
    linesToBlocks, splitSentences, ocrTextToLines, makeCMapReaderFactory,
  };
});
