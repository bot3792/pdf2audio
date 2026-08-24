# Read-along: the documents the reader consumes

The reader in `packages/web/src/pages/Reader.tsx` draws a book's own PDF page and highlights
the sentence being spoken. It reads two JSON documents and nothing else — no database row, no
tRPC call. That constraint is the point: anything the documents fail to carry shows up in the
reader immediately, and a second implementation of these documents needs nothing from this
codebase but this page.

Both documents carry `"format": "p2af/1"`. A reader should check the major version, open
anything it recognises, and say something useful about anything it does not.

## `GET /read/book/:bookId/book.json`

```jsonc
{
  "format": "p2af/1",
  "book":    { "id": "…", "title": "…", "language": "en", "medianBodyPt": 11.7 },
  "sources": [ { "index": 0, "filename": "book.pdf", "url": "/pdf/…", "pageCount": 294 } ],
  "pages":   [ { "i": 0, "src": 0, "w": 311, "h": 487, "rot": 0,
                 "content": [43, 45.7, 228.6, 387], "columns": [[43, 45.7, 228.6, 387]] } ],
  "chapters":[ { "i": 0, "id": "…", "title": "…",
                 "audio": "/audio/chapter/…", "cues": "/read/chapter/…/cues.json",
                 "durationMs": 2706000, "pageStart": 168, "pageEnd": 180, "mode": "page" } ]
}
```

- **`pages` is flat across a book's PDFs.** A book can have several source files; `i` counts
  pages across all of them in order and `src` says which file a page came from. Chapter
  `pageStart`/`pageEnd` are flat indices too, so a reader never has to do this arithmetic.
- **`w`, `h`, `content` and `columns` are PDF points**, origin top-left, y downwards. `content`
  is the union of the page's text lines; `columns` are the column boxes in reading order, one
  entry for a single-column page. Both are `[x, y, width, height]`.
- **`medianBodyPt`** is the median height of a text line, weighted by how much text the line
  holds — not the font size the PDF reports, which several real files give as 1pt or 53pt for
  ordinary 10pt text. It is what tells a reader, before the reader squints, whether this book
  can be read at a given width.
- **`mode`** is `"page"` when the chapter's spoken text can be pinned to the PDF, and `"text"`
  when it cannot — an edited chapter, a generated one, or an extraction older than the text
  map. A `"text"` chapter still has cues and audio; it just has no rectangles.

## `GET /read/chapter/:chapterId/cues.json`

```jsonc
{
  "format": "p2af/1",
  "totalMs": 2706000,
  "granularity": "word",
  "cues": [
    { "t": [0, 4210],
      "s": "Such a study would indeed be of great interest.",
      "r": [[168, 1641, 6550, 7068, 243]],
      "w": [[0, 488, "Such"], [488, 550, "a"], [550, 900, "study"]] }
  ]
}
```

- **`t`** is `[startMs, endMs]` into the chapter's audio. Cues are ordered and non-overlapping;
  there can be gaps between them, and a reader should keep the last cue lit across a gap rather
  than blinking the highlight out.
- **`s`** is the spoken text. Concatenated in order, the cues *are* the chapter's text — which
  is why a reflowed text view needs no further document.
- **`r`** is a list of `[page, x, y, width, height]`, where `page` is the flat page index and
  the rest are **ten-thousandths of that page's box**, origin top-left. Ten-thousandths keep a
  ten-hour book's rects to a megabyte or two, and a percentage of the rendered page is the same
  number divided by a hundred. Absent when the cue has no place on the page.
- **`w`** is `[startMs, endMs, word]` per word, present only where the engine reported timings.

### `granularity`

Says what a highlight actually means, so a reader can be honest about it:

| value | meaning |
| --- | --- |
| `word` | every cue is a sentence and carries word timings |
| `sentence` | some chunks carried word timings and became sentences; the rest are whole chunks |
| `chunk` | no word timings — one highlight is a whole synthesis chunk, often a paragraph |

Kokoro reports word timings during synthesis. Engines chunked a sentence at a time (macOS
`say`, MMS) land on sentence-sized chunks without them. The Bulgarian MLX narrator emits a fixed
~20–24 s per chunk by design and stays at `chunk`, as does any audio synthesized before word
timings existed.

## How the rectangles are produced

1. `chapters.text_map` records where each source block starts and ends inside `cleanText`,
   written by the normalize worker (`lib/normalizer.ts`, `workers/normalize.ts`).
2. A cue's text is located in `cleanText` (`locateChunks`), giving a character range, which the
   text map resolves to source blocks and a sub-range within each.
3. `scripts/page_geometry.py` extracts, per page, the line boxes and one x edge per character
   straight from pdfium via `pdftext` — no model, about four seconds for a 300-page book, and it
   works on books extracted long ago. Cached beside the extraction output as `geometry.json`.
4. `lib/cue-rects.ts` finds the block's lines geometrically, looks the cue's characters up in
   them — both sides reduced to letters and digits, so markdown stripping and hyphen joins can't
   defeat the match — and turns the result into rects.

The ladder, coarser but never wrong: character-exact line rects → the whole line → the block's
box → nothing at all when the page's geometry is unknown. A range crossing many lines becomes
the shape a text selection takes: partial first line, solid middle, partial last.
