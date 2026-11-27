// Packs pdf.js' CMap files into vendor/cmaps.js so the app can read PDFs whose
// fonts use predefined encodings (Chinese, Japanese, Korean and some others)
// without fetch(), which the page's Content-Security-Policy blocks.
// Usage: npm install && npm run build:cmaps
const fs = require("fs");
const path = require("path");

const src = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "cmaps");
const version = require("pdfjs-dist/package.json").version;
const out = path.join(__dirname, "..", "vendor", "cmaps.js");

const map = {};
for (const f of fs.readdirSync(src).sort()) {
  if (!f.endsWith(".bcmap")) continue;
  map[f.slice(0, -".bcmap".length)] = fs.readFileSync(path.join(src, f)).toString("base64");
}
const license = fs.readFileSync(path.join(src, "LICENSE"), "utf8").trim().split("\n").map((l) => " * " + l).join("\n");
fs.writeFileSync(out,
  `/*\n * Adobe CMaps, packed from pdfjs-dist@${version} by tools/build-cmaps.js.\n *\n${license}\n */\n` +
  `self.PDFJS_BUNDLED_CMAPS = ${JSON.stringify(map)};\n`);
console.log(`wrote ${Object.keys(map).length} CMaps to ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
