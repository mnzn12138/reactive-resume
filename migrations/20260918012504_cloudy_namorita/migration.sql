CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_index" ON "admin_audit_log" ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_type_target_id_index" ON "admin_audit_log" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_id_created_at_index" ON "admin_audit_log" ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "instance_setting_updated_at_index" ON "instance_setting" ("updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;