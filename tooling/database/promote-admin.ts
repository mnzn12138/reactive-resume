import { eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { user } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

/**
 * Promote (or demote) a user to admin.
 *
 * The admin console needs at least one admin to exist before it can be used,
 * so the very first one has to be created outside the app — otherwise you get
 * a chicken-and-egg problem where only an admin can make an admin.
 *
 * Usage:
 *   pnpm admin:promote -- user@example.com        # promote
 *   pnpm admin:promote -- user@example.com --revoke
 *
 * The identifier can be an email or a username.
 */
const USAGE = "Usage: pnpm admin:promote -- <email-or-username> [--revoke]";

async function setAdminRole(identifier: string, revoke: boolean) {
	const pool = new Pool({ connectionString: env.DATABASE_URL });
	const db = drizzle({ client: pool });

	try {
		const [target] = await db
			.select({ id: user.id, email: user.email, username: user.username, role: user.role })
			.from(user)
			.where(or(eq(user.email, identifier), eq(user.username, identifier)))
			.limit(1);

		if (!target) {
			console.error(`No user found with email or username "${identifier}".`);
			process.exitCode = 1;
			return;
		}

		const nextRole = revoke ? "user" : "admin";
		if (target.role === nextRole) {
			console.log(`${target.email} is already "${nextRole}". Nothing to do.`);
			return;
		}

		await db.update(user).set({ role: nextRole }).where(eq(user.id, target.id));

		console.log(`${target.email} (${target.username}) is now "${nextRole}".`);
		if (!revoke) console.log("They can sign in and open /admin.");
	} catch (error) {
		console.error("Failed to update role:", error);
		process.exitCode = 1;
	} finally {
		await pool.end();
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const revoke = args.includes("--revoke");
	const identifier = args.find((arg) => arg !== "--revoke" && !arg.startsWith("--"));

	if (!identifier) {
		console.error(USAGE);
		process.exitCode = 1;
	} else {
		await setAdminRole(identifier, revoke);
	}
}
