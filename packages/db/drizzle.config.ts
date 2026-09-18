import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit` reads `DATABASE_URL` straight from `process.env` and never
 * loads `.env` itself, so a bare `pnpm db:migrate` fails with `url: ''`.
 *
 * Loading the files here makes the scripts work standalone. Existing values win
 * — `loadEnvFile` does not overwrite what the shell or CI already exported — so
 * production keeps using whatever was injected.
 */
for (const file of ["../../.env.local", "../../.env"]) {
	const path = new URL(file, import.meta.url);
	if (existsSync(path)) loadEnvFile(path);
}

export default defineConfig({
	schema: "./src/schema/index.ts",
	out: "../../migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL || "",
	},
});
