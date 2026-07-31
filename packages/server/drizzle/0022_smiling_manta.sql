CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"result" text NOT NULL,
	"scope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "raw_text" text;--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "raw_words" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "note_job" jsonb;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;