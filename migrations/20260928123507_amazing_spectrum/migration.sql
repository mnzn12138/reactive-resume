CREATE TABLE "user_consent" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"document" text NOT NULL,
	"version" text NOT NULL,
	"source" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_consent_user_id_document_version_index" ON "user_consent" ("user_id","document","version");--> statement-breakpoint
CREATE INDEX "user_consent_user_id_created_at_index" ON "user_consent" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "user_consent" ADD CONSTRAINT "user_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;