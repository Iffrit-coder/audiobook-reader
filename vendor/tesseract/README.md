# Bundled text recognition (Tesseract)

Used only for scanned PDFs (pages that are pictures with no text layer).
Loaded on demand by `pdf-ocr.js`; nothing here runs for ordinary PDFs.

| File | From | License |
|---|---|---|
| `tesseract.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0 `dist/` | Apache-2.0 |
| `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) 6.1.2 | Apache-2.0 (`LICENSE`) |
| `lang/{eng,spa,heb}.traineddata.gz` | `@tesseract.js-data/*` 1.0.0, `4.0.0_best_int` (from [tessdata](https://github.com/tesseract-ocr/tessdata_best)) | Apache-2.0 |

To add a language, copy its `4.0.0_best_int/<code>.traineddata.gz` from
`@tesseract.js-data/<code>` into `lang/` and add it to `LANGS` in `pdf-ocr.js`.
