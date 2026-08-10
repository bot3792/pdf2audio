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

Builds a podcast-style book from today's top Hacker News stories — one chapter per story, curiosity-hook opening, community reaction explicitly signposted and capped at ~20% of the chapter:

```sh
node scripts/hn-top10.mjs                  # 10 stories, chapters suspended for review
node scripts/hn-top10.mjs --synthesize     # queue TTS immediately
node scripts/hn-top10.mjs --count 5 --api http://localhost:3034
```

Zero dependencies; needs `DEEPSEEK_API_KEY` (env or root `.env`) since the summarization runs in the script, not the server. Stories come from the official HN Firebase/Algolia APIs; article text is fetched and tag-stripped (falls back to title + discussion when a site blocks fetching).
