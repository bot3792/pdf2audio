ALTER TABLE "chapters" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "source_blocks" jsonb;
