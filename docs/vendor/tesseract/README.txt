Vendored on 21 Nov 2026 by lane beerscan (owner item I-140: scan a beer label).
Loaded ONLY on demand by docs/js/beerscan.js, when the user taps "Läs texten" in the beer scanner. Never at app start.
Nothing here sends an image anywhere: OCR runs in a Web Worker on the phone.

Files (do not edit; replace them with newer copies from npm):
- tesseract.min.js, worker.min.js        npm tesseract.js@7.0.0 (dist/), Apache-2.0  -> LICENSE-tesseract.js.txt,
                                          bundled deps -> LICENSE-bundled-deps.txt
- tesseract-core-simd-lstm.js + .wasm    npm tesseract.js-core@7.0.0, Apache-2.0      -> LICENSE-tesseract.js-core.txt
                                          (only the SIMD + LSTM build: every Chrome since 91 and Safari 16.4 has WASM SIMD;
                                          a phone without it gets "type the name" instead)
- eng.traineddata.gz                     npm @tesseract.js-data/eng@1.0.0, file 4.0.0_best_int/eng.traineddata.gz (MIT package;
                                          the model is tessdata_best from the Tesseract project, Apache-2.0)
The worker is started from its URL (workerBlobURL: false): a blob: worker would inherit the page CSP, which has no
'wasm-unsafe-eval'.
