/**
 * Placeholder identity for providers that never return an email address.
 *
 * WeChat and Alipay both hand back a subject and a nickname and nothing else, so
 * there is no address to put on the `user` row. Better Auth rejects a provider
 * that yields no email (`EMAIL_NOT_FOUND` in the callback), which would make
 * both channels unusable — so we synthesise one.
 *
 * The address is deliberately **not** a real mailbox:
 *
 * - The domain is derived from the instance, so it is obviously ours and cannot
 *   collide with a provider that does return real addresses.
 * - `emailVerified` stays `false`, so it never satisfies a "verified email"
 *   check and no verification mail is ever sent to it.
 * - The local part carries the provider subject, so it is stable and unique per
 *   provider account.
 */

/** Domain used when `APP_URL` is missing or unparseable — unreachable by design. */
export const FALLBACK_PLACEHOLDER_DOMAIN = "users.noreply.local";

const PLACEHOLDER_DOMAIN_PREFIX = "users.noreply.";

/**
 * `wechat_abc123@users.noreply.example.com` for `APP_URL=https://example.com`.
 *
 * Falls back to a fixed domain when the instance URL is unusable: a wrong but
 * inert address is better than throwing while the user is mid-login.
 */
export function resolvePlaceholderEmailDomain(appUrl: string | undefined): string {
	if (!appUrl) return FALLBACK_PLACEHOLDER_DOMAIN;

	try {
		const hostname = new URL(appUrl).hostname;
		if (!hostname) return FALLBACK_PLACEHOLDER_DOMAIN;
		return `${PLACEHOLDER_DOMAIN_PREFIX}${hostname}`;
	} catch {
		return FALLBACK_PLACEHOLDER_DOMAIN;
	}
}

/** Keeps only what a username (and an email local part) may contain. */
function sanitizeSubject(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "");
}

/**
 * Builds the placeholder address for one provider account.
 *
 * The local part is `<channel>_<subject>` so two providers that happen to issue
 * the same subject cannot claim the same address, and the whole thing stays
 * inside the character set `username` validation accepts.
 */
export function buildPlaceholderEmail(input: {
	channel: "wechat" | "alipay" | "phone";
	subject: string;
	appUrl?: string | undefined;
}): string {
	const subject = sanitizeSubject(input.subject) || "user";
	// 64 characters is the column's practical limit; keep room for the channel
	// prefix and the domain so the address never gets truncated mid-subject.
	const localPart = `${input.channel}_${subject}`.slice(0, 64);

	return `${localPart}@${resolvePlaceholderEmailDomain(input.appUrl)}`;
}
