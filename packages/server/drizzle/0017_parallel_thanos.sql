CREATE TABLE "chapter_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"language" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_translations_chapter_language" UNIQUE("chapter_id","language")
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "translation_language" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD CONSTRAINT "chapter_translations_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;