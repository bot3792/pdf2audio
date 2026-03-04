ALTER TABLE "books" ADD COLUMN "force_ocr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "llm_chapter_detection" boolean DEFAULT false NOT NULL;
