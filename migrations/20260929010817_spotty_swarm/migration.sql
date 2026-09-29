CREATE TABLE "sms_send_log" (
	"id" text PRIMARY KEY,
	"phone_hash" text NOT NULL,
	"ip_hash" text,
	"vendor" text NOT NULL,
	"result_code" text NOT NULL,
	"vendor_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "openid" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_phone_number_key" UNIQUE("phone_number");--> statement-breakpoint
CREATE INDEX "sms_send_log_phone_hash_created_at_index" ON "sms_send_log" ("phone_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sms_send_log_ip_hash_created_at_index" ON "sms_send_log" ("ip_hash","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sms_send_log_created_at_index" ON "sms_send_log" ("created_at" DESC NULLS LAST);