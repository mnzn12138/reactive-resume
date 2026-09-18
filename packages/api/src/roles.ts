/**
 * The only roles this instance understands.
 *
 * `user.role` is an unconstrained `text` column (Better Auth's default), so
 * nothing stops a bad write from putting arbitrary values there. Every read of
 * the role therefore goes through this whitelist — an unknown value is treated
 * as a plain user, never as something privileged.
 */
export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Narrow an untrusted role value. Returns `null` for anything outside the
 * whitelist, including `null`/`undefined` (the column is nullable).
 */
export function parseUserRole(value: unknown): UserRole | null {
	if (typeof value !== "string") return null;
	return (USER_ROLES as readonly string[]).includes(value) ? (value as UserRole) : null;
}

/**
 * Whether the role grants admin access. Deliberately strict equality against
 * `"admin"` so an unrecognised value can never inherit privileges.
 */
export function isAdminRole(value: unknown): boolean {
	return value === "admin";
}

/**
 * Guard for writes: only these two values may ever be persisted to `user.role`.
 * Throws so callers fail loudly instead of silently storing a typo that
 * quietly grants (or withholds) access.
 */
export function assertUserRole(value: string): UserRole {
	const role = parseUserRole(value);
	if (!role) {
		throw new Error(`Invalid user role: "${value}". Expected one of: ${USER_ROLES.join(", ")}.`);
	}
	return role;
}
