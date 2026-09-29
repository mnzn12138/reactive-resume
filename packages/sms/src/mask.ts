/**
 * Masking helpers. Anything rendered into the admin console or a log line goes through here so a
 * credential never leaves the process in full.
 */

/**
 * Keeps the last four characters, replaces the rest with `*` (at least four stars so short values
 * do not leak their length).
 */
export const maskSecret = (value: string): string => {
	if (value === "") return "";

	const visible = value.slice(-4);

	return `${"*".repeat(Math.max(4, value.length - visible.length))}${visible}`;
};
