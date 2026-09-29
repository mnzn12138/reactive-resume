/** Parses a vendor response body without throwing; vendor payloads are not always JSON. */
export const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
	if (text === "") return undefined;

	try {
		const parsed: unknown = JSON.parse(text);

		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}

		return undefined;
	} catch {
		return undefined;
	}
};
