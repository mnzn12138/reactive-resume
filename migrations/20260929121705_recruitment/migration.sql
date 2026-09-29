CREATE TABLE "recruitment_post" (
	"id" text,
	"created_by" text,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"company_logo_url" text,
	"batch" text DEFAULT 'regular' NOT NULL,
	"employment_type" text[] DEFAULT '{}'::text[] NOT NULL,
	"work_mode" text[] DEFAULT '{}'::text[] NOT NULL,
	"work_intensity" text[] DEFAULT '{}'::text[] NOT NULL,
	"locations" text[] DEFAULT '{}'::text[] NOT NULL,
	"education_required" text[] DEFAULT '{}'::text[] NOT NULL,
	"benefits" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"salary_text" text,
	"deadline" timestamp with time zone,
	"rolling" boolean DEFAULT false NOT NULL,
	"apply_url" text,
	"contact_kind" text,
	"contact_value" text,
	"referral_code" text,
	"summary" text,
	"source" text,
	"source_url" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"report_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_recruitment_post" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "recruitment_post_bookmark" (
	"user_id" text,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_recruitment_post_bookmark" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "recruitment_post_report" (
	"id" text,
	"post_id" text NOT NULL,
	"reporter_id" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"handled" boolean DEFAULT false NOT NULL,
	"handled_by" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_recruitment_post_report" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recruitment_post_dedupe_key" ON "recruitment_post" ("dedupe_key");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_status_published_at" ON "recruitment_post" ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_deadline" ON "recruitment_post" ("deadline");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_tags" ON "recruitment_post" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_locations" ON "recruitment_post" USING gin ("locations");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_created_by" ON "recruitment_post" ("created_by");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_status_report_count" ON "recruitment_post" ("status","report_count" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_bookmark_post_id" ON "recruitment_post_bookmark" ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_recruitment_post_report_post_id_reporter_id" ON "recruitment_post_report" ("post_id","reporter_id");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_report_post_id" ON "recruitment_post_report" ("post_id");--> statement-breakpoint
CREATE INDEX "ix_recruitment_post_report_handled_created_at" ON "recruitment_post_report" ("handled","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "recruitment_post" ADD CONSTRAINT "recruitment_post_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "recruitment_post" ADD CONSTRAINT "recruitment_post_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "recruitment_post_bookmark" ADD CONSTRAINT "recruitment_post_bookmark_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recruitment_post_bookmark" ADD CONSTRAINT "recruitment_post_bookmark_post_id_recruitment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "recruitment_post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recruitment_post_report" ADD CONSTRAINT "recruitment_post_report_post_id_recruitment_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "recruitment_post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recruitment_post_report" ADD CONSTRAINT "recruitment_post_report_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recruitment_post_report" ADD CONSTRAINT "recruitment_post_report_handled_by_user_id_fkey" FOREIGN KEY ("handled_by") REFERENCES "user"("id") ON DELETE SET NULL;