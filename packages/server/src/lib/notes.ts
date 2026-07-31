import { db } from "../db.ts";
import { notes, type NoteScope } from "../schema.ts";

export async function saveNote(input: {
  bookId: string;
  prompt: string;
  model: "flash" | "pro";
  result: string;
  scope: NoteScope;
}): Promise<string> {
  const [note] = await db.insert(notes).values(input).returning({ id: notes.id });
  return note.id;
}
