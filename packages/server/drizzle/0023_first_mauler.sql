ALTER TABLE "books" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "pdf_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "kind" text DEFAULT 'pdf' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "digest_job" jsonb;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "source" jsonb;