CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"pdf_path" text NOT NULL,
	"output_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"voice" text DEFAULT 'af_heart' NOT NULL,
	"speed" real DEFAULT 1 NOT NULL,
	"error" text,
	"total_chapters" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"clean_text" text,
	"audio_path" text,
	"duration_ms" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;