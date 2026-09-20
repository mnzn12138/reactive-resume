import { hash } from "bcrypt";
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { account, user } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

/**
 * Set a new password for an existing account, from the command line.
 *
 * The web flow at `/auth/forgot-password` depends on working SMTP. A
 * self-hosted instance without it has no way back in once an administrator
 * forgets their password, so this is the escape hatch — it mirrors
 * `admin:promote`, which exists for the same reason (the app cannot bootstrap
 * itself).
 *
 * Usage:
 *   pnpm admin:reset-password -- user@example.com 'new-password'
 *
 * The identifier can be an email or a username. The password is hashed with
 * bcrypt, the same way Better Auth does it, so it works with the normal
 * sign-in form afterwards.
 */

// Mirrors `emailAndPassword` in packages/auth/src/config.ts.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 64;
const BCRYPT_ROUNDS = 10;

// Mirrors the sign-in path's hashing so the account can sign in normally afterwards.
const USAGE = "Usage: pnpm admin:reset-password -- <email-or-username> <new-password>";

async function resetPassword(identifier: string, password: string) {
	if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
		console.error(
			`Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters (got ${password.length}).`,
		);
		process.exitCode = 1;
		return;
	}

	const pool = new Pool({ connectionString: env.DATABASE_URL });
	const db = drizzle({ client: pool });

	try {
		const [target] = await db
			.select({ id: user.id, email: user.email, username: user.username })
			.from(user)
			.where(or(eq(user.email, identifier), eq(user.username, identifier)))
			.limit(1);

		if (!target) {
			console.error(`No user found with email or username "${identifier}".`);
			process.exitCode = 1;
			return;
		}

		const passwordHash = await hash(password, BCRYPT_ROUNDS);

		// Better Auth keeps credential passwords on the `account` row whose
		// `accountId` is the user id (see packages/db/src/schema/auth.ts).
		const updated = await db
			.update(account)
			.set({ password: passwordHash })
			.where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
			.returning({ id: account.id });

		if (updated.length === 0) {
			// A social-only account never had a password row. Creating one is the
			// point of an escape hatch, so do not fail here.
			await db.insert(account).values({
				accountId: target.id,
				providerId: "credential",
				userId: target.id,
				password: passwordHash,
			});

			console.log(`Added password sign-in for ${target.email} (${target.username}).`);
		} else {
			console.log(`Password updated for ${target.email} (${target.username}).`);
		}

		console.log("They can sign in with the new password immediately.");
	} catch (error) {
		console.error("Failed to reset password:", error);
		process.exitCode = 1;
	} finally {
		await pool.end();
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const identifier = args.find((arg) => !arg.startsWith("--"));
	const password = args.filter((arg) => !arg.startsWith("--"))[1];

	if (!identifier || !password) {
		console.error(USAGE);
		process.exitCode = 1;
	} else {
		await resetPassword(identifier, password);
	}
}
