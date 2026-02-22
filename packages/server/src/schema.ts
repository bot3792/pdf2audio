import { pgTable, uuid, text, real, integer, timestamp, boolean } from "drizzle-orm/pg-core";

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
  totalChapters: integer("total_chapters").notNull().default(0),
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
  audioPath: text("audio_path"),
  durationMs: integer("duration_ms"),
  progress: text("progress"),
  status: text("status", {
    enum: ["pending", "normalizing", "synthesizing", "done", "failed", "suspended"],
  }).notNull().default("pending"),
  selected: boolean("selected").notNull().default(true),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookLogs = pgTable("book_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assemblies = pgTable("assemblies", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookId: uuid("book_id").notNull().references(() => books.id, { onDelete: "cascade" }),
  outputPath: text("output_path").notNull(),
  durationMs: integer("duration_ms").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  chapterSummary: text("chapter_summary").notNull(),
  chapterIds: text("chapter_ids").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type BookLog = typeof bookLogs.$inferSelect;
export type Assembly = typeof assemblies.$inferSelect;
