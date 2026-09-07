#!/usr/bin/env node
// Regenerates article.html — a small, realistic article page used to test
// `src/web/extract-article.ts` and `src/web/parse-web.ts`. Run with
// `node test/fixtures/web/build.mjs` from the package root whenever the fixture needs to
// change; the parser tests read the committed file, not this script.
//
// The equation markup is real KaTeX output (`katex.renderToString`), not hand-typed, so the
// `katexEquation` Turndown rule in `src/web/html-to-markdown.ts` is exercised against exactly
// the shape a browser would actually produce.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import katex from 'katex'

const inlineEquation = katex.renderToString('E=mc^2', { throwOnError: false, displayMode: false })
const blockEquation = katex.renderToString('\\int_0^1 x^2\\,dx', {
  throwOnError: false,
  displayMode: true,
})

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Spaced repetition, the short version</title>
  <meta name="author" content="Ada Lovelace" />
</head>
<body>
  <header><nav><a href="/">Home</a> · <a href="/archive">Archive</a></nav></header>
  <aside class="sidebar"><p>Subscribe to our newsletter!</p></aside>
  <article>
    <h1>Spaced repetition, the short version</h1>
    <p>Retrieval practice beats re-reading. The classic result is worth restating in one line:
      forcing recall, then getting feedback, is what moves an item from short-term recognition
      to long-term <a href="https://en.wikipedia.org/wiki/Recall_(memory)">recall</a>.</p>

    <h2>Why spacing works</h2>
    <p>The interval between reviews should grow every time you get the item right. The classic
      curve is the exponential-ish forgetting curve; a single review's expected stability
      change is often written as ${inlineEquation}, which mangles nothing here because it is
      the point: an inline formula must survive.</p>
    <p>See the note on measured effect sizes<sup id="fnref-1"><a href="#fn-1">1</a></sup> for
      the numbers behind this.</p>

    <h3>A worked derivation</h3>
    <p>Integrating the forgetting curve over one interval gives the expected retrievability:</p>
    <div class="math-block">${blockEquation}</div>
    <pre><code class="language-python">def next_interval(stability, difficulty):
    return stability * (1 - difficulty / 10)
</code></pre>

    <h2>What this changes in practice</h2>
    <p>A diagram of the review cycle:</p>
    <p><img src="images/diagram.png" alt="Review cycle diagram" width="480" height="240" /></p>
    <table>
      <tr><th>Stage</th><th>Interval</th></tr>
      <tr><td>Learning</td><td>1 day</td></tr>
      <tr><td>Review</td><td>6 days</td></tr>
    </table>
    <img src="https://track.adservice.example.net/pixel.gif" alt="" width="1" height="1" />

    <h3>Sources</h3>
    <ol class="footnotes">
      <li id="fn-1">Dunlosky et al. (2013) put retrieval practice and spacing in the "high
        utility" tier. <a href="#fnref-1">&#8617;</a></li>
    </ol>
  </article>
  <footer><p>&copy; 2026 Example Press. All rights reserved.</p></footer>
</body>
</html>
`

await writeFile(join(import.meta.dirname, 'article.html'), html)
console.log('wrote', join(import.meta.dirname, 'article.html'))
