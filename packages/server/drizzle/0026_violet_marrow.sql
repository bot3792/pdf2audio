CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "book_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"folder_id" uuid,
	"source" text NOT NULL,
	"book_file_id" uuid,
	"chapter_id" uuid,
	"translation_id" uuid,
	"language" text,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"source_hash" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "book_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "search_index" jsonb;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "profile_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_chunks" ADD CONSTRAINT "book_chunks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chunks" ADD CONSTRAINT "book_chunks_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chunks" ADD CONSTRAINT "book_chunks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chunks" ADD CONSTRAINT "book_chunks_translation_id_chapter_translations_id_fk" FOREIGN KEY ("translation_id") REFERENCES "public"."chapter_translations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_chunks_book_id_idx" ON "book_chunks" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_chunks_profile_id_idx" ON "book_chunks" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "book_chunks_file_seq_idx" ON "book_chunks" USING btree ("book_file_id","seq");--> statement-breakpoint
CREATE INDEX "book_chunks_chapter_seq_idx" ON "book_chunks" USING btree ("chapter_id","seq");--> statement-breakpoint
CREATE INDEX "book_chunks_tsv_idx" ON "book_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "book_chunks_embedding_idx" ON "book_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
UPDATE "notes" SET "profile_id" = "books"."profile_id" FROM "books" WHERE "notes"."book_id" = "books"."id";