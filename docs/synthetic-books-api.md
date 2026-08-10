# Synthetic Books API

Plain JSON HTTP endpoints for creating books and chapters from scripts and other projects — no tRPC client needed. The server does no AI work here: callers send finished chapter text (summarize/generate however you like) and the app handles storage, TTS, assembly, translations, search indexing, and exports.

Base URL: the API server (default `http://localhost:3034`). Optional `x-profile-id` header scopes the book to a profile (same convention as the web app; omitted → default profile).

## POST /api/books

Create a synthetic book (`kind: "api"`), optionally with chapters in the same call.

```json
{
  "title": "Hacker News Top 10 — Aug 10, 2026",
  "client": "hn-top10",
  "folderId": "<uuid, optional>",
  "voice": "<voice id, optional — validated, defaults like the web app>",
  "speed": 1.0,
  "synthesize": false,
  "chapters": [
    { "title": "Story one", "text": "Chapter text…", "url": "https://example.com/article" }
  ]
}
```

- `client` — free-form identifier of the calling script; stored in `books.origin` and chapter sources.
- `chapters[].url` — optional; when present the chapter gets a `{kind:"url"}` source and the UI renders a "source ↗" link. Without it the source is `{kind:"api"}`.
- `synthesize: false` (default) — chapters arrive **suspended** for review in the web UI, like digest chapters.
- `synthesize: true` — chapters are queued straight through normalize → TTS with the book's voice; poll `GET /api/books/:id` for audio readiness.

Response `201`:

```json
{ "id": "<bookId>", "title": "…", "chapters": [{ "id": "…", "index": 0, "title": "Story one" }] }
```

`400` with `{ "error": … }` (and `issues` for validation failures).

## POST /api/books/:bookId/chapters

Append chapters to an existing book (any kind — appending to a PDF book tags them as inserted, so re-extraction/redetection preserves them). Body: `{ client?, chapters: [...], synthesize? }` — same chapter shape and semantics as above. Chapters are appended after the highest existing index. Response `201` like create; `404` if the book doesn't exist.

## GET /api/books/:bookId

Status poll for scripts:

```json
{
  "id": "…", "title": "…", "kind": "api", "status": "pending", "outputReady": false,
  "chapters": [
    { "id": "…", "index": 0, "title": "…", "status": "done", "error": null, "durationMs": 812345, "hasAudio": true }
  ]
}
```

## Example consumer: scripts/hn-top10.mjs

Builds a podcast-style book from a day's top Hacker News stories — one chapter per story, curiosity-hook opening, community reaction explicitly signposted and capped at ~20% of the chapter:

```sh
node scripts/hn-top10.mjs                        # today's top 10, chapters suspended for review
node scripts/hn-top10.mjs --date 2026-08-09      # any past day (hckrnews archives)
node scripts/hn-top10.mjs --synthesize --count 5 # queue TTS immediately
```

Needs `DEEPSEEK_API_KEY` (env or root `.env`) since the summarization runs in the script, not the server, plus the workspace-root deps (`pnpm install`). Story lists come from [hckrnews.com](https://hckrnews.com/) and replicate its "top 10" tab exactly: the site groups stories into UTC days (archived at `/data/YYYYMMDD.js` — one file is one day group) and shows each group's top N by points. For days not yet archived the group is reconstructed from `latest.js` plus the server-rendered homepage, cut by UTC date. Any historical day works even after stories drop off the HN front page (`--list` prints a day's top stories without creating anything, verified 1:1 against the site's top-10 view); comments come from the Algolia HN API. Article text is extracted with [Defuddle](https://github.com/kepano/defuddle) + linkedom (falls back to title + discussion when a site blocks fetching).
