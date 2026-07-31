import { pgTable, uuid, text, real, integer, timestamp, boolean, jsonb, unique } from "drizzle-orm/pg-core";

export type ChapterProposalBoundary = {
  fileIndex: number | null;
  blockIndex: number;
  title: string;
  titleTranslated?: string;
  page: number;
};

export type ChapterProposal = {
  status: "running" | "done" | "failed";
  method: "llm" | "deterministic";
  detection?: "llm" | "numbered-headings" | "heading-levels";
  boundaries?: ChapterProposalBoundary[];
  error?: string;
  createdAt: string;
};

export type ChapterCleanup = {
  status: "pending" | "cleaning" | "done" | "failed" | "suspended";
  progress?: string;
  error?: string;
  runToken?: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteJob = {
  status: "queued" | "running" | "done" | "failed";
  prompt: string;
  model: "flash" | "pro";
  error?: string;
  noteId?: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteScope =
  | { kind: "chapters"; chapters: { id: string; title: string }[] }
  | { kind: "book-raw"; files: number };

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  pdfPath: text("pdf_path").notNull(),
  outputPath: text("output_path"),
  status: text("status", {
    enum: ["pending", "extracting", "synthesizing", "assembling", "done", "failed", "suspended"],
  }).notNull().default("pending"),
  voice: text("voice").notNull().default("af_heart"),
  speed: real("speed").notNull().default(1.0),
  error: text("error"),
  forceOcr: boolean("force_ocr").notNull().default(false),
  llmChapterDetection: boolean("llm_chapter_detection").notNull().default(false),
  chapterDetection: text("chapter_detection").$type<"llm" | "numbered-headings" | "heading-levels" | "word-split" | "manual">(),
  chapterProposal: jsonb("chapter_proposal").$type<ChapterProposal>(),
  translationLanguage: text("translation_language"),
  skipSynthesis: boolean("skip_synthesis").notNull().default(false),
  totalChapters: integer("total_chapters").notNull().default(0),
  noteJob: jsonb("note_job").$type<NoteJob>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  title: text("title").notNull(),
  rawText: text("raw_text").notNull(),
  cleanText: text("clean_text"),
  customText: text("custom_text"),
  audioPath: text("audio_path"),
  durationMs: integer("duration_ms"),
  progress: text("progress"),
  status: text("status", {
    enum: ["pending", "normalizing", "synthesizing", "done", "failed", "suspended"],
  }).notNull().default("pending"),
  selected: boolean("selected").notNull().default(true),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
  sourceBlocks: jsonb("source_blocks"),
  sourceFileIndex: integer("source_file_index"),
  synthesizedWith: jsonb("synthesized_with").$type<{ voice?: string; speed?: number | null }>(),
  cleanup: jsonb("cleanup").$type<ChapterCleanup>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chapterTranslations = pgTable("chapter_translations", {
  id: uuid("id").primaryKey().defaultRandom(),
  chapterId: uuid("chapter_id").notNull().references(() => chapters.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  title: text("title"),
  text: text("text").notNull().default(""),
  status: text("status", {
    enum: ["pending", "translating", "done", "failed", "suspended"],
  }).notNull().default("pending"),
  progress: text("progress"),
  error: text("error"),
  sourceHash: text("source_hash"),
  // Fencing token: each translate run writes only while its token is current
  runToken: text("run_token"),
  audioPath: text("audio_path"),
  audioDurationMs: integer("audio_duration_ms"),
  audioStatus: text("audio_status", {
    enum: ["pending", "synthesizing", "done", "failed", "suspended"],
  }),
  audioProgress: text("audio_progress"),
  audioError: text("audio_error"),
  synthesizedWith: jsonb("synthesized_with").$type<{ voice?: string; speed?: number | null }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("chapter_translations_chapter_language").on(t.chapterId, t.language)]);

export const bookLogs = pgTable("book_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  fileIndex: integer("file_index"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookFiles = pgTable("book_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  filename: text("filename").notNull(),
  pdfPath: text("pdf_path").notNull(),
  // "raw" = raw text only, marker extraction neither queued nor planned
  status: text("status", {
    enum: ["raw", "pending", "extracting", "done", "failed"],
  }).notNull().default("pending"),
  selected: boolean("selected").notNull().default(true),
  skipSynthesis: boolean("skip_synthesis").notNull().default(false),
  rawText: text("raw_text"),
  rawWords: integer("raw_words"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assemblies = pgTable("assemblies", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  language: text("language"),
  outputPath: text("output_path").notNull(),
  durationMs: integer("duration_ms").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  chapterSummary: text("chapter_summary").notNull(),
  chapterIds: text("chapter_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  language: text("language"),
  format: text("format", { enum: ["pdf", "epub"] }).notNull(),
  outputPath: text("output_path").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  chapterSummary: text("chapter_summary").notNull(),
  chapterIds: text("chapter_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  model: text("model", { enum: ["flash", "pro"] }).notNull(),
  result: text("result").notNull(),
  scope: jsonb("scope").$type<NoteScope>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type BookLog = typeof bookLogs.$inferSelect;
export type BookFile = typeof bookFiles.$inferSelect;
export type NewBookFile = typeof bookFiles.$inferInsert;
export type Assembly = typeof assemblies.$inferSelect;
export type BookDocument = typeof documents.$inferSelect;
export type ChapterTranslation = typeof chapterTranslations.$inferSelect;
export type Note = typeof notes.$inferSelect;
