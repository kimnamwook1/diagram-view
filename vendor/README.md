# Bundled libraries

Unmodified files from npm, bundled so that drawing needs no download. They run only inside the offline headless Chrome page that `renderer/render.mjs` builds. Fonts come from `dist/fonts/` of the same KaTeX release.

| File | Package | Path in package | SHA-256 |
| --- | --- | --- | --- |
| katex.min.js | katex@0.19.1 | dist/katex.min.js | fa140498b8cfc8302cbe5e7cb1bdbc1f952bc38b3fa258ede09e73edbf9a74bc |
| katex.min.css | katex@0.19.1 | dist/katex.min.css | 00e0b094171b07f58422075f469b4feac2b2f7bce1aeec943c08da4d697f4dcf |
| vega.min.js | vega@6.4.0 | build/vega.min.js | 8f6a3587cf8d4f42c7e08120e3eb05d067e746d554e39d2dcf52acc0bd5ba28f |
| vega-lite.min.js | vega-lite@6.5.0 | build/vega-lite.min.js | 83e215e84e308ee8688fa6503ba0f1cf8a3c05c0d61df2841a0b92bf86809e00 |
| chart.umd.min.js | chart.js@4.6.1 | dist/chart.umd.min.js | 87364cc2b2a76a6684929e7d6b80b18a897794db38400caff1fcf1791c6925d2 |
