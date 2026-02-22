# Task: Chapter Merge & Split

## Goal

Allow merging adjacent chapters into one, or splitting a chapter into two, to fix imperfect chapter boundaries from automatic detection.

## Why

Marker's heading detection often gets boundaries wrong — merging things that should be separate, or splitting things that shouldn't be. After extraction, the user needs a way to adjust chapter boundaries before (or after) synthesis.

## Design Decisions

### Merge: "Merge with next" button per chapter row

Chosen over multi-select for simplicity:
- A small action button on each chapter row that merges it with the chapter below
- No multi-select state needed, no adjacency validation logic
- Merging 3 chapters = 2 clicks (merge first with next, then merge again with the new next)
- Obvious, predictable behavior

### Split: Paragraph-boundary picker in ChapterModal

Chosen over percentage/slider for precision:
- In ChapterModal, show the raw text with visible paragraph breaks (`\n\n` boundaries)
- Click between paragraphs to place a split point
- Hit "Split here" to create two chapters from one
- The text is already displayed in the modal — this builds on existing UI

### Audio invalidation after merge/split

Any chapter whose text changed gets fully reset:
- `cleanText` → null (force re-normalization)
- `audioPath` → null, `durationMs` → null (invalidate audio)
- `status` → "pending"
- `progress` → null
- Stale audio files deleted from disk

Chapters that weren't touched keep their audio. No silent re-processing — the user queues synthesis when ready.

### Blocked during processing

Merge/split should only be allowed when the book is NOT actively extracting/assembling, and the affected chapters are in a "stable" state (`pending`, `done`, `failed`, or `suspended`). Reject if any affected chapter is `normalizing` or `synthesizing`.

### Title handling

- **Merge:** Keep the first chapter's title by default. Could prompt for rename but start simple.
- **Split:** First part keeps the original title. Second part gets `"{title} (cont.)"`.

## Implementation

### No schema migration needed

The existing schema supports this. We're creating/deleting/updating chapter rows, not adding columns.

### Server: New tRPC mutations

#### `chapters.merge` 

Input: `{ id: string (uuid) }` — the chapter to merge with its next sibling.

Steps (in a transaction):
1. Fetch the chapter and its book
2. Find the next chapter by `bookId` and `index = chapter.index + 1`
3. Reject if either chapter is currently processing (`normalizing` or `synthesizing`)
4. Reject if the book is `extracting` or `assembling`
5. Concatenate `rawText` values with `\n\n` separator
6. Update the first chapter: new `rawText`, clear `cleanText`/`audioPath`/`durationMs`/`progress`, set status to `pending`
7. Delete the second chapter row
8. Delete stale audio files from disk (both chapters' old audio, if any)
9. Reindex: decrement `index` by 1 for all chapters in the book with `index > deletedChapter.index`
10. Rename audio files on disk for reindexed chapters (or just invalidate them — simpler)
11. Update `books.totalChapters`

**Decision point on step 10:** Renaming existing audio files for chapters that didn't change is complex and error-prone. Simpler alternative: only invalidate the two merged chapters' audio, leave other chapters' audio intact. The `audioPath` in DB is an absolute path, so as long as we don't rename files, other chapters keep working. The filename (`ch003.mp3`) would no longer match the `index` (now 2), but that's cosmetic — assembly uses `audioPath` from DB, not computed from index.

**Recommendation:** Don't rename files. Just invalidate the merged chapters' audio. Accept that filenames may not match indexes after merge/split. Assembly already uses `audioPath` from DB.

Wait — the synthesize worker creates the filename from `chapter.index`. So after a merge, if you re-synthesize a reindexed chapter, the new filename will match the new index. Old orphaned files (from the deleted chapter) should be cleaned up. This works.

#### `chapters.split`

Input: `{ id: string (uuid), splitAfterParagraph: number }` — the chapter to split, and the paragraph index (0-based, counting `\n\n`-delimited blocks) after which to split.

Steps (in a transaction):
1. Fetch the chapter and its book
2. Reject if chapter is currently processing
3. Reject if book is `extracting` or `assembling`
4. Split `rawText` at the paragraph boundary into `textA` and `textB`
5. Update the original chapter: `rawText = textA`, clear `cleanText`/`audioPath`/`durationMs`/`progress`, status to `pending`
6. Increment `index` by 1 for all chapters in the book with `index > originalChapter.index`
7. Insert new chapter row: `bookId`, `index = originalChapter.index + 1`, `title = "{originalTitle} (cont.)"`, `rawText = textB`, status `pending`
8. Delete stale audio file from disk (original chapter's old audio, if any)
9. Update `books.totalChapters`

Same approach: don't rename other chapters' audio files. They keep their existing `audioPath`.

### Server: Helper for paragraph splitting

Add a utility that splits `rawText` into paragraphs by `\n\n` and validates the split point. Used by both the split mutation (to perform the split) and a query (to provide paragraph boundaries to the UI).

#### `chapters.paragraphs`

New query. Input: `{ id: string (uuid) }`. Returns an array of paragraph strings so the frontend can render them with clickable split points between them.

Or: the frontend already has `rawText` from `chapters.get`. It can split by `\n\n` client-side. The server just needs the `splitAfterParagraph` index. Simpler — no new query needed.

### Frontend: BookDetail.tsx

Add a "Merge down" button/icon to each chapter row (except the last chapter). Same area as existing action buttons (Queue, Suspend, Redo). Perhaps a small icon showing two arrows merging, or just a text button.

- Disabled during processing
- Confirmation step: "Merge '{Chapter 3}' into '{Chapter 2}'? Both chapters will need re-synthesis." (or skip confirmation — it's a power user tool and the operation is reversible via re-extract)
- After mutation, invalidate the `books.get` query to refresh the chapter list

### Frontend: ChapterModal.tsx — Split UI

When viewing a chapter's text, add a "Split mode" toggle or button. When active:

- Render `rawText` split into paragraphs (by `\n\n`)
- Show a clickable divider/button between each paragraph: "Split here"
- Clicking "Split here" calls `chapters.split` with the paragraph index
- After mutation, close modal, invalidate query

The split UI only needs to show in the "raw" text view tab (not "clean" or "split" comparison views).

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/routes/chapters.ts` | Add `merge` and `split` mutations |
| `packages/server/src/router.ts` | (only if new router needed — probably not) |
| `packages/web/src/pages/BookDetail.tsx` | Add "Merge down" button per chapter row |
| `packages/web/src/components/ChapterModal.tsx` | Add split mode with paragraph-boundary picker |

## Edge Cases

- **Merge the only chapter** — no next sibling, button shouldn't appear
- **Merge when next chapter has audio but first doesn't** — both get invalidated, that's fine
- **Split a chapter with only one paragraph** — no split points available, disable split mode or show message
- **Split a chapter that's already synthesized** — audio invalidated, needs re-synthesis
- **Rapid merges** — user merges 3 chapters by clicking twice quickly. Each merge is a separate transaction. Second merge sees the already-merged chapter and merges again. Should work if we invalidate queries between mutations.
- **Re-extract after merge/split** — re-extract (`books.retry`) deletes all chapters and re-creates them from the PDF. All merge/split edits are lost. This is expected — re-extract is a "start over" action. Could warn the user but not strictly necessary.

## Testing

1. Extract a multi-chapter PDF
2. Merge chapter 2 with chapter 3 — verify: chapter 3 disappears, chapter 2 has combined text, chapter 2 status is `pending`, subsequent chapters reindexed
3. Split the merged chapter at a paragraph boundary — verify: two chapters created, both `pending`, indexes correct
4. Synthesize all, assemble — verify the MP3 plays correctly with correct chapter markers
5. Try to merge/split during active synthesis — verify it's rejected
6. Merge the last chapter with nothing after it — verify button is disabled/hidden
7. Verify `books.totalChapters` updates correctly after merge and split
