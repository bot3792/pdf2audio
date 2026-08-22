// Shared so a toolbar restyle is one edit rather than nine, and so the voice trigger keeps matching
// the buttons it sits beside. Follows the class-constant convention of ACTION_PILL in ChapterTable.
export const TOOLBAR_BUTTON =
  "text-xs px-2.5 py-1 rounded bg-(--bg-card) border border-(--border) text-(--text-secondary) hover:bg-(--bg-subtle) font-medium disabled:opacity-30 disabled:cursor-not-allowed";
