# Task: Chapter Selection + Assembly as First-Class Action

## Goal

Add per-chapter include/exclude checkboxes and make assembly a repeatable first-class action. Users can select which chapters to include in the final MP3 and trigger assembly at any time — not just when all chapters are done.

## Design Philosophy

Assembly is NOT a terminal "done" state. It's a tool you run whenever you want:
- Assemble after 3 chapters are synthesized to test the output
- Exclude garbage chapters (TOC, bibliography, index, foreign-language columns)
- Re-assemble after changing voices on specific chapters
- Re-assemble after editing chapter text

The "Re-assemble" button should appear whenever **at least one included chapter has audio** — not gated on the book being "done."

## Schema Change

Add to `chapters` table in `packages/server/src/schema.ts`:

```ts
included: boolean("included").notNull().default(true),
```

Then run:

```bash
pnpm db:generate
pnpm db:migrate
```

The migration adds the column with `DEFAULT true`, so all existing chapter rows get `true` automatically.

## Server Changes

### `packages/server/src/routes/chapters.ts`

Add mutations:

**`chapters.setIncluded`** — toggle a single chapter
- Input: `{ id: string (uuid), included: boolean }`
- Updates the `included` column

**`chapters.setAllIncluded`** — batch toggle for a book
- Input: `{ bookId: string (uuid), included: boolean }`
- Updates all chapters for the book at once
- Used by the "toggle all" checkbox in the header

### `packages/server/src/routes/books.ts`

Add mutation:

**`books.reassemble`**
- Input: `{ id: string (uuid) }`
- Validates that at least one included chapter has `status === "done"` and `audioPath`
- Queues an `assemble` job with `{ bookId }`
- Clears the book's `outputPath` (so the old MP3 doesn't get served while re-assembling)

### `packages/server/src/workers/assemble.ts`

Filter chapters to only include those where `included === true`:

```ts
// Before
const allChapters = await db.select()...orderBy(asc(chapters.index));

// After
const allChapters = await db.select()...where(eq(chapters.included, true))...orderBy(asc(chapters.index));
```

Only included chapters get concatenated and get CHAP/CTOC frames in the ID3 tags.

**Edge case**: if zero chapters are included, the assemble worker should fail gracefully with a clear error message.

### `packages/server/src/routes/books.ts` (books.get response)

The `included` field comes through automatically from the schema. No extra mapping needed — just ensure the chapter response includes it.

## UI Changes

### `packages/web/src/pages/BookDetail.tsx`

**Chapter table header:**
- Add a checkbox in the first column header (before `#`)
- Checked state: all chapters included → checked; some → indeterminate; none → unchecked
- Clicking toggles all via `chapters.setAllIncluded`

**Chapter table rows:**
- Add a checkbox as the first column in each row
- Checked state reflects `chapter.included` from the API response
- Toggling calls `chapters.setIncluded` immediately (optimistic update preferred)
- Unchecked rows could have a subtle visual difference (e.g., slightly dimmed text) to indicate they're excluded

**"Assemble" / "Re-assemble" button:**
- Appears in the book header area (near existing action buttons)
- Label: "Assemble" if no outputPath exists, "Re-assemble" if one does
- Enabled when: at least one included chapter has `status === "done"`
- Disabled with tooltip when: no included chapters have audio
- Clicking calls `books.reassemble`

**Default behavior unchanged:**
- All chapters are `included: true` by default
- The auto-assemble at the end of synthesis still works (it reads from the DB, and all chapters are included)
- The only difference is the assemble worker now filters by `included`

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/schema.ts` | Add `included` boolean column |
| `packages/server/drizzle/` | Generated migration |
| `packages/server/src/routes/chapters.ts` | Add `setIncluded` and `setAllIncluded` mutations |
| `packages/server/src/routes/books.ts` | Add `books.reassemble` mutation |
| `packages/server/src/workers/assemble.ts` | Filter by `included === true` |
| `packages/web/src/pages/BookDetail.tsx` | Checkboxes, toggle-all, assemble button |

## Testing

1. Extract + synthesize a multi-chapter PDF — all chapters should be checked by default
2. Verify the final assembled MP3 includes all chapters (unchanged default behavior)
3. Uncheck 2 chapters, click "Re-assemble" — verify the new MP3 excludes those chapters
4. Toggle-all unchecked, then toggle-all checked — verify batch mutation works
5. Uncheck all chapters, verify "Assemble" button is disabled
6. With a partially-synthesized book, check that "Assemble" appears when at least one included chapter has audio
7. Verify chapter markers in the assembled MP3 only include the selected chapters
8. Verify unchecked chapter rows appear visually dimmed
