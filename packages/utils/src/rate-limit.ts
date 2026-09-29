export const TRUSTED_IP_HEADERS = [
	"CF-Connecting-IP",
	"CF-Connecting-IPv6",
	"True-Client-IP",
	"X-Forwarded-For",
	"X-Real-IP",
];

export const rateLimitConfig = {
	betterAuth: {
		global: {
			enabled: true,
			window: 60,
			max: 60,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 3 },
				"/request-password-reset": { window: 600, max: 3 },
				"/send-verification-email": { window: 600, max: 3 },
				"/two-factor/verify-otp": { window: 600, max: 5 },
				"/two-factor/verify-totp": { window: 600, max: 5 },
				"/two-factor/verify-backup-code": { window: 600, max: 5 },
				"/is-username-available": { window: 60, max: 20 },
				// The `phoneNumber` plugin ships its own 60s/10 rule for
				// `/phone-number/*`, but it is keyed on the request alone and cannot
				// see the sign-in shortcut. These two are the coarse front door:
				// per-number and per-IP windows (60s cooldown, 10/day, 20/hour) are
				// enforced separately in `packages/sms/rate-limit` against
				// `sms_send_log`, which is the only place that can count them.
				"/phone-number/send-otp": { window: 60, max: 5 },
				"/sign-in/phone-number": { window: 60, max: 5 },
			},
		},
		oauthProvider: {
			register: { window: 60, max: 5 },
			authorize: { window: 60, max: 30 },
			token: { window: 60, max: 20 },
			introspect: { window: 60, max: 60 },
			revoke: { window: 60, max: 30 },
			userinfo: { window: 60, max: 60 },
		},
	},
	orpc: {
		resumePassword: { maxRequests: 5, window: 10 * 60 * 1000 },
		pdfExport: { maxRequests: 5, window: 60 * 1000 },
		aiRequest: { maxRequests: 20, window: 60 * 1000 },
		storageUpload: { maxRequests: 20, window: 60 * 1000 },
		storageDelete: { maxRequests: 30, window: 60 * 1000 },
		resumeMutations: { maxRequests: 300, window: 60 * 1000 },
		// Submitting a post is rare and moderated, so the ceiling is per hour rather than
		// per minute: a determined spammer would otherwise fill the review queue faster
		// than an administrator can clear it.
		recruitmentSubmissions: { maxRequests: 10, window: 60 * 60 * 1000 },
		// Post detail is where the contact details live; without this a script could walk
		// every id and harvest WeChat ids / referral codes from a public endpoint.
		recruitmentReads: { maxRequests: 60, window: 60 * 1000 },
	},
} as const;
