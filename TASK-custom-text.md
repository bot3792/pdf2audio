# Task: Editable Chapter Text with Custom Override

## Goal

Allow users to manually edit chapter text before synthesis. Edits are stored as a separate `customText` column — `rawText` and `cleanText` remain immutable. Synthesis uses the fallback chain: `customText ?? cleanText ?? rawText`.

## Key Principles

- `rawText` — immutable, from Marker extraction
- `cleanText` — immutable, from normalizer
- `customText` — nullable, null by default, only set when user manually edits
- No auto-synthesis on edit — user manually hits "Re-synthesize"
- No normalization on custom text — user is responsible for the content

## Schema Change

Add to `chapters` table in `packages/server/src/schema.ts`:

```ts
customText: text("custom_text"),
```

Then run:

```bash
pnpm db:generate
pnpm db:migrate
```

## Server Changes

### `packages/server/src/workers/synthesize.ts`

Change text selection from:

```ts
const text = chapter.cleanText ?? chapter.rawText;
```

to:

```ts
const text = chapter.customText ?? chapter.cleanText ?? chapter.rawText;
```

### `packages/server/src/routes/chapters.ts`

Add two new mutations:

**`chapters.updateText`**
- Input: `{ id: string (uuid), customText: string }`
- Sets `customText` on the chapter row
- Does NOT trigger re-synthesis

**`chapters.resetText`**
- Input: `{ id: string (uuid) }`
- Sets `customText` to `null`
- Does NOT trigger re-synthesis

### `packages/server/src/routes/books.ts`

In `books.get`, add `hasCustomText: !!ch.customText` to the chapter response alongside existing `hasCleanText`.

## UI Changes

### `packages/web/src/components/ChapterModal.tsx`

The text preview area gains edit capability:

1. **Read-only modes stay**: Clean / Raw / Split tabs remain as read-only views of the immutable text
2. **Add "Edit" button** next to the view mode tabs — clicking it switches the text area to an editable textarea
3. **Editable textarea** pre-filled with `customText ?? cleanText ?? rawText`
4. **Action buttons when editing**:
   - "Save" — calls `chapters.updateText`, exits edit mode
   - "Cancel" — discards unsaved changes, exits edit mode
5. **When chapter has customText (not null)**:
   - Show a visual indicator (e.g., "Edited" badge near the title, or the text area has a subtle border color)
   - Show "Reset" button that calls `chapters.resetText` to null out customText
   - The Clean/Raw/Split tabs still show the original immutable text for reference

### `packages/web/src/pages/BookDetail.tsx`

In the chapter table rows, show a small visual indicator (e.g., a pencil icon or "edited" text) if the chapter has custom text (`hasCustomText: true`). This lets the user see at a glance which chapters were manually modified.

## Files to Modify

| File | Change |
|------|--------|
| `packages/server/src/schema.ts` | Add `customText` column |
| `packages/server/drizzle/` | Generated migration (via `pnpm db:generate`) |
| `packages/server/src/workers/synthesize.ts` | Use `customText ?? cleanText ?? rawText` |
| `packages/server/src/routes/chapters.ts` | Add `updateText` and `resetText` mutations |
| `packages/server/src/routes/books.ts` | Add `hasCustomText` to chapter response |
| `packages/web/src/components/ChapterModal.tsx` | Editable text area, save/reset/cancel buttons |
| `packages/web/src/pages/BookDetail.tsx` | Visual indicator for chapters with custom text |
| `packages/web/src/trpc.ts` | No change needed (auto-inferred from router) |

## Testing

1. Open a chapter modal — text should be read-only by default
2. Click "Edit" — textarea becomes editable, pre-filled with clean text
3. Modify text, click "Save" — `customText` stored in DB
4. Close and reopen modal — edited text persists, "Edited" indicator visible
5. Hit "Re-synthesize" — synthesis uses the custom text
6. Hit "Reset" — `customText` nulled, falls back to clean text
7. Check chapter table row shows "edited" indicator for modified chapters
8. Verify Clean/Raw/Split tabs still show original immutable text even when custom text exists
