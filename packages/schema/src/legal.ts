import { z } from "zod";

/**
 * The legal documents this instance publishes. The matching routes live in
 * `apps/web/src/routes/_home/` (privacy.tsx / terms.tsx).
 */
export const legalDocumentSchema = z.enum(["privacy", "terms"]);

export type LegalDocument = z.infer<typeof legalDocumentSchema>;

export const legalDocuments: readonly LegalDocument[] = legalDocumentSchema.options;

/**
 * Bump this whenever the published documents change in a way that needs fresh consent. A user whose
 * newest consent row is an older version is treated as not having accepted the current text.
 */
export const legalDocumentVersion = "2026-09-28";

export const legalDocumentRoutes: Record<LegalDocument, string> = {
	privacy: "/privacy",
	terms: "/terms",
};

/**
 * What the signup form posts. `accepted` is a literal `true` on purpose: a client cannot claim
 * consent it did not obtain, and the server validates this before the user row is created.
 */
export const legalConsentSchema = z.object({
	accepted: z.literal(true),
	version: z.string().min(1),
});

export type LegalConsent = z.infer<typeof legalConsentSchema>;
