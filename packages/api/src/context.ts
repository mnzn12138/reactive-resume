import type { AuthSession } from "@reactive-resume/auth/types";
import type { Locale } from "@reactive-resume/utils/locale";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";
import { auth, verifyOAuthToken } from "@reactive-resume/auth/config";
import { db } from "@reactive-resume/db/client";
import { user } from "@reactive-resume/db/schema";
import { isAdminRole } from "./roles";

/**
 * Better Auth's base `User` type does not carry the columns the admin plugin
 * adds (`role`, `banned`, …), so the session-inferred shape is used instead.
 */
type AuthUser = AuthSession["user"];

interface ORPCContext {
	locale: Locale;
	reqHeaders: Headers;
	resHeaders?: Headers;
	trustedClient?: string;
}

async function getUserFromBearerToken(headers: Headers): Promise<AuthUser | null> {
	try {
		const authHeader = headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) return null;

		const payload = await verifyOAuthToken(authHeader.slice(7));
		if (!payload?.sub) return null;

		const [userResult] = await db.select().from(user).where(eq(user.id, payload.sub)).limit(1);
		return userResult ?? null;
	} catch (error) {
		console.warn("Bearer token verification failed:", error);
		return null;
	}
}

async function getUserFromHeaders(headers: Headers): Promise<AuthUser | null> {
	try {
		const result = await auth.api.getSession({ headers });
		if (!result?.user) return null;

		return result.user;
	} catch (error) {
		console.warn("Session verification failed:", error);
		return null;
	}
}

/**
 * Resolve the authenticated user from the same headers oRPC uses
 * (`Authorization: Bearer` or session cookies). Tries each auth method in
 * priority order and returns the first valid identity. Used directly by
 * oRPC's `publicProcedure` and by callers outside oRPC handlers (e.g. MCP
 * tools) where `context.user` is not in scope.
 */
export async function resolveUserFromRequestHeaders(headers: Headers): Promise<AuthUser | null> {
	const bearerUser = await getUserFromBearerToken(headers);
	if (bearerUser) return bearerUser;

	return getUserFromHeaders(headers);
}

const base = os.$context<ORPCContext>();

export const publicProcedure = base.use(async ({ context, next }) => {
	const user = await resolveUserFromRequestHeaders(context.reqHeaders);

	return next({
		context: {
			...context,
			user,
		},
	});
});

export const protectedProcedure = publicProcedure.use(({ context, next }) => {
	if (!context.user) throw new ORPCError("UNAUTHORIZED");

	return next({
		context: {
			...context,
			user: context.user,
		},
	});
});

/**
 * Gate for everything under `/admin`.
 *
 * Runs on top of `protectedProcedure`, so an unauthenticated caller still gets
 * UNAUTHORIZED rather than FORBIDDEN — the client needs to be able to tell
 * "log in first" apart from "you are not allowed".
 *
 * The role is read straight off the resolved user; see `./roles` for why the
 * check is a strict equality against `"admin"`.
 */
export const adminProcedure = protectedProcedure.use(({ context, next }) => {
	if (!isAdminRole(context.user.role)) throw new ORPCError("FORBIDDEN", { message: "Administrator access required." });

	return next({
		context: {
			...context,
			user: context.user,
		},
	});
});
