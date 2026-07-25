ALTER TABLE "assemblies" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "source_hash" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "audio_path" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "audio_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "audio_status" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "audio_progress" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "audio_error" text;--> statement-breakpoint
ALTER TABLE "chapter_translations" ADD COLUMN "synthesized_with" jsonb;