// Run with: npm install && npm test
// Exercises pdf-text.js against the PDFs in tests/fixtures (regenerate them
// with `npm run fixtures`), using the same pdf.js version as vendor/.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// pdf.js warns about canvas/standard fonts in Node; irrelevant to text extraction.
const origWarn = console.warn, origLog = console.log;
console.warn = () => {};
console.log = (...a) => { if (!/^Warning:/.test(String(a[0]))) origLog(...a); };
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const PdfText = require("../pdf-text.js");

const FIX = path.join(__dirname, "fixtures");
const cmapCtx = { self: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "vendor", "cmaps.js"), "utf8"), cmapCtx);
const CMapReaderFactory = PdfText.makeCMapReaderFactory(() => cmapCtx.self.PDFJS_BUNDLED_CMAPS);

async function open(name, extra = {}) {
  const data = new Uint8Array(fs.readFileSync(path.join(FIX, name)));
  return pdfjsLib.getDocument({ data, verbosity: 0, CMapReaderFactory, useWorkerFetch: false, ...extra }).promise;
}
async function read(name, extra) {
  const pdf = await open(name, extra);
  const res = await PdfText.extractDocument(pdf, { ops: pdfjsLib.OPS });
  const blocks = PdfText.linesToBlocks(res.lines, pdf.numPages);
  return { ...res, blocks, text: blocks.map((b) => b.text).join("\n") };
}

test("words split across font changes are not broken apart", async () => {
  const { text } = await read("font-change.pdf");
  assert.equal(text, "This paragraph starts in bold. A wonderful word was half italic.");
});

test("letters placed one by one still form words", async () => {
  const { text } = await read("split-glyphs.pdf");
  assert.equal(text, "Every letter of this sentence is placed on its own. Reading it should still give whole words.");
});

test("words positioned without space characters get spaces", async () => {
  const { text } = await read("no-spaces.pdf");
  assert.equal(text, "These words have no space characters between them.");
});

test("hyphenated line breaks are rejoined", async () => {
  const { text } = await read("hyphenated.pdf");
  assert.match(text, /words that were hyphenated at the end/);
  assert.match(text, /each example is spoken/);
  assert.match(text, /Keep New- York style/);   // capital after the break: a real hyphen, kept
});

test("a soft hyphen at a line end always rejoins the word", () => {
  const SHY = String.fromCharCode(0xAD);
  const lines = [{ text: "every" + SHY, size: 10, page: 1 }, { text: "Thing counts", size: 10, page: 1 }];
  assert.deepEqual(PdfText.linesToBlocks(lines, 1), [{ type: "text", text: "everyThing counts" }]);
  assert.equal(PdfText.cleanText("co" + SHY + "operate"), "cooperate");
});

test("ligatures become plain letters", async () => {
  const { text } = await read("ligatures.pdf");
  assert.equal(text, "The first office floor had an efficient staff.");
  assert.equal(PdfText.cleanText("\uFB01nd the \uFB02ag"), "find the flag");
});

test("two side-by-side columns are read one after the other", async () => {
  const { text } = await read("two-columns.pdf");
  assert.equal(text, "Left column first line of the story continues here. Right column has its own separate text to read.");
});

test("lines without end-of-line markers still break into lines", async () => {
  const { lines } = await read("no-eol.pdf");
  assert.deepEqual(lines.map((l) => l.text), ["First line ends here", "second line keeps going."]);
});

test("CJK text whose font uses a predefined CMap is read", async () => {
  const { text } = await read("cjk.pdf");
  assert.equal(text, "日本語の文章です。");
});

test("password-protected PDFs open with the password and ask again when wrong", async () => {
  await assert.rejects(open("encrypted.pdf"), (e) => e.name === "PasswordException");
  const { text } = await read("encrypted.pdf", { password: "secret" });
  assert.equal(text, "This document needs a password to open.");

  const data = new Uint8Array(fs.readFileSync(path.join(FIX, "encrypted.pdf")));
  const task = pdfjsLib.getDocument({ data, verbosity: 0 });
  const reasons = [];
  task.onPassword = (update, reason) => { reasons.push(reason); update(reasons.length === 1 ? "wrong" : "secret"); };
  const pdf = await task.promise;
  assert.equal(pdf.numPages, 1);
  assert.deepEqual(reasons, [pdfjsLib.PasswordResponses.NEED_PASSWORD, pdfjsLib.PasswordResponses.INCORRECT_PASSWORD]);
});

test("scanned pages are flagged for text recognition", async () => {
  const { imagePages, lines } = await read("scanned.pdf");
  assert.deepEqual(imagePages, [1]);
  assert.equal(lines.length, 0);
});

test("running headers and page numbers are dropped, headings kept", async () => {
  const { blocks } = await read("book.pdf");
  assert.deepEqual(blocks.map((b) => b.type), ["title", "text", "title", "text", "title", "text"]);
  assert.equal(blocks[0].text, "Chapter 1");
  assert.ok(!blocks.some((b) => /Downloaded/.test(b.text)));
});

test("sentences don't split after abbreviations or initials", () => {
  const s = PdfText.splitSentences("Dr. Smith arrived late, e.g. by an hour. J. R. R. Tolkien wrote it. See Fig. 3 and p. 12. Done! Really? Yes.");
  assert.deepEqual(s, ["Dr. Smith arrived late, e.g. by an hour.", "J. R. R. Tolkien wrote it.", "See Fig. 3 and p. 12.", "Done!", "Really?", "Yes."]);
  // still loss-less
  const t = "It costs 3.5 dollars. Then... nothing. The end";
  assert.equal(PdfText.splitSentences(t).join(" "), t);
  assert.deepEqual(PdfText.splitSentences("\u4eca\u65e5\u306f\u3002\u660e\u65e5\u3082\u3002"), ["\u4eca\u65e5\u306f\u3002", "\u660e\u65e5\u3082\u3002"]);
  assert.deepEqual(PdfText.splitSentences("El Sr. Pérez llegó. La Dra. Gómez también."), ["El Sr. Pérez llegó.", "La Dra. Gómez también."]);
});

test("OCR text becomes paragraphs with rejoined hyphenation", () => {
  const lines = PdfText.ocrTextToLines("This is a scan-\nned page.\n\nSecond para-\ngraph here.\n", 4);
  const blocks = PdfText.linesToBlocks(lines, 4);
  assert.deepEqual(blocks, [
    { type: "text", text: "This is a scanned page." },
    { type: "text", text: "Second paragraph here." },
  ]);
});

test("odd whitespace and invisible characters are cleaned", () => {
  assert.equal(PdfText.cleanText("a\u00A0b\u200Bc\uFEFFd\u2002e"), "a bcd e");
  assert.equal(PdfText.cleanText("½ x²"), "½ x²"); // the speech layer still sees the symbols
});

test.after(() => { console.warn = origWarn; console.log = origLog; });
