ALTER TABLE "chapter_translations" ADD COLUMN "kind" text DEFAULT 'translation' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "params" jsonb;