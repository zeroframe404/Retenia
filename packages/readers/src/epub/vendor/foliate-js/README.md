# foliate-js (vendored)

Unmodified copies of two modules from [foliate-js](https://github.com/johnfactotum/foliate-js)
by John Factotum, MIT licensed (see `LICENSE` in this directory):

- `epubcfi.js` — EPUB Canonical Fragment Identifier parsing, comparison and
  `Range`⇄CFI conversion.
- `epub.js` — container/OPF/NCX parsing into a spine, manifest and table of contents, behind a
  `{ loadText, loadBlob, getSize, sha1 }` loader the caller supplies.

Fetched from the `main` branch on 2026-09-07. Vendored rather than taken as the `foliate-js`
npm package: that package (`foliate-js@1.0.1`) is an unofficial third-party republish — a
different maintainer and organization than the upstream repository — not the author's own
release.

`epub.js` imports only `epubcfi.js`; neither imports a zip reader or touches the DOM outside
the `Document`/`Range` APIs it is handed, so both run as plain ES modules with no build step.
`packages/readers/src/epub/epub-loader.ts` supplies the loader (over `@zip.js/zip.js`'s
`HttpReader`, so a `media://` source is read with HTTP Range requests rather than pulled
into memory whole) and `packages/readers/src/epub/epub-cfi.ts` wraps the CFI functions this
package actually calls.

Do not hand-edit these two files — pull a fresh copy from upstream instead, so a diff against
the source stays meaningful.
