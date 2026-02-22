# Task: Preserve Marker JSON Output + Future Column Filtering

## Goal

Stop deleting the raw Marker JSON output after extraction so it can be re-parsed later with different settings (e.g., column filtering for two-column parallel text layouts).

## Background

Marker outputs a JSON file with full block-level data including `bbox`/`polygon` coordinates for every text block. Currently we parse this JSON in `lib/marker.ts`, extract only `{ type, text, hierarchy }` per block, and the temp directory (`data/tmp/{bookId}/`) may get cleaned up.

For books with two-column parallel text (e.g., original + translation side by side), we need the bbox coordinates to classify blocks as left/right column. Preserving the JSON avoids re-running the 30+ minute extraction.

## Phase 1: Preserve the JSON (do this now)

### `packages/server/src/workers/extract.ts`

Ensure `data/tmp/{bookId}/` is NOT deleted after extraction. If there's any cleanup code that removes the temp directory, remove it or skip it.

### `packages/server/src/lib/marker.ts`

After extraction, the JSON file lives at `data/tmp/{bookId}/{pdfStem}/{pdfStem}.json` (Marker nests output in a subdirectory named after the PDF stem). The code already finds this file by searching one level deep. No changes needed here — just make sure nothing deletes the parent directory.

### Verify

After extracting a PDF, confirm the JSON still exists at `data/tmp/{bookId}/`.

## Phase 2: Column filtering (future, not now)

This is for later when the user wants to filter two-column layouts.

### What the Marker JSON contains per block

```json
{
  "id": "/page/0/Text/0",
  "block_type": "Text",
  "html": "<p>Some paragraph text...</p>",
  "bbox": [x1, y1, x2, y2],
  "polygon": [[x1,y1], [x2,y1], [x2,y2], [x1,y2]],
  "section_hierarchy": { "1": "Chapter Title" },
  "children": [...]
}
```

The `bbox` field gives us `[x_start, y_start, x_end, y_end]`. For a two-column page, left column blocks have `x_start` in roughly the left half of the page, right column blocks in the right half.

### How column filtering would work

1. Parse the preserved Marker JSON
2. For each page, determine the page midpoint from the page bbox
3. Classify each block as left/right based on `bbox[0]` (x_start) relative to the midpoint
4. Filter blocks to keep only the desired column
5. Re-run chapter detection + normalization on the filtered blocks
6. Update the chapters in the DB

### UI for column filtering

Add a "Column" option to the book settings (or extraction settings):
- `null` (default) — no filtering, use all blocks
- `"left"` — keep only left column blocks
- `"right"` — keep only right column blocks

Could be a per-book setting on the `books` table, or a re-extraction option in the UI.

### Schema change (future)

Add to `books` table:

```ts
columnFilter: text("column_filter"),  // null | "left" | "right"
```

### Types to update in `lib/marker.ts` (future)

The `MarkerBlock` type needs `bbox` added:

```ts
type MarkerBlock = {
  id: string;
  block_type: string;
  html: string;
  bbox?: [number, number, number, number];
  polygon?: number[][];
  children: MarkerBlock[] | null;
  section_hierarchy: Record<string, string> | null;
};
```

The `collectTextBlocks` function would need to include bbox in its output so filtering can happen before chapter detection.

## Files to Modify

### Phase 1 (now)
| File | Change |
|------|--------|
| `packages/server/src/workers/extract.ts` | Ensure tmp dir is not deleted after extraction |

### Phase 2 (future)
| File | Change |
|------|--------|
| `packages/server/src/schema.ts` | Add `columnFilter` to books table |
| `packages/server/src/lib/marker.ts` | Add bbox to MarkerBlock type, add column filtering to collectTextBlocks |
| `packages/server/src/workers/extract.ts` | Pass column filter option to extraction |
| `packages/web/src/components/UploadZone.tsx` | Add column filter dropdown |
| UI book detail | Add re-extract with column filter option |

## Testing (Phase 1)

1. Extract a PDF
2. Check that `data/tmp/{bookId}/` still exists after extraction completes
3. Verify the JSON file is present and contains bbox data on blocks
