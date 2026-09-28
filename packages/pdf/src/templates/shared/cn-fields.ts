import type { CustomField } from "@reactive-resume/schema/resume/data";

/**
 * The set of resume fields that Chinese employers conventionally expect on a
 * domestic ( mainland China ) resume but that the resume schema does not model
 * as first class citizens. They currently only exist as free text custom
 * fields, e.g. "政治面貌:中共党员".
 *
 * These keys are the *stable* identifiers. A2 is expected to add an optional
 * `key` to `customFieldSchema`; when it does, `resolveCnFieldKey` picks it up
 * on day one with zero changes to any template.
 */
export type CnFieldKey =
	| "gender"
	| "birthDate"
	| "ethnicity"
	| "politicalStatus"
	| "nativePlace"
	| "hukou"
	| "maritalStatus"
	| "height";

export const CN_FIELD_KEYS = [
	"gender",
	"birthDate",
	"ethnicity",
	"politicalStatus",
	"nativePlace",
	"hukou",
	"maritalStatus",
	"height",
] as const satisfies readonly CnFieldKey[];

/**
 * Recognised label spellings per key, used only when a custom field carries no
 * explicit `key`. Order matters only for readability; lookups go through a map.
 *
 * NOTE: this whitelist is *data*, not UI copy. The label rendered into the PDF
 * always comes from the user's own text, so no template ever hardcodes a
 * Chinese string (packages/pdf has no i18n runtime).
 */
const CN_FIELD_LABELS = {
	politicalStatus: ["政治面貌", "政治面目", "政治成分"],
	ethnicity: ["民族", "族别"],
	birthDate: ["出生年月", "出生日期", "生日", "出生"],
	gender: ["性别"],
	nativePlace: ["籍贯"],
	hukou: ["户籍", "户口所在地", "户口"],
	maritalStatus: ["婚姻状况", "婚姻"],
	height: ["身高"],
} as const satisfies Readonly<Record<CnFieldKey, readonly string[]>>;

const FULLWIDTH_COLON = "\uFF1A";
const HALFWIDTH_COLON = "\u003A";

/** Separator used when a claimed field is re-rendered as a "label: value" pair. */
export const CN_FIELD_SEPARATOR = FULLWIDTH_COLON;
const CN_FIELD_KEY_SET: ReadonlySet<string> = new Set<string>(CN_FIELD_KEYS);

const LABEL_TO_KEY: ReadonlyMap<string, CnFieldKey> = new Map<string, CnFieldKey>(
	(Object.entries(CN_FIELD_LABELS) as [CnFieldKey, readonly string[]][]).flatMap(([key, labels]) =>
		labels.map((label) => [normalizeLabel(label), key] as const),
	),
);

/** Collapses regular and ideographic whitespace, then lowercases (no-op for CJK). */
function normalizeLabel(value: string): string {
	return value
		.trim()
		.replace(/[\s\u3000]/g, "")
		.toLowerCase();
}

export type ParsedCnField = {
	/** The label exactly as the user authored it, whitespace trimmed. */
	label: string;
	/** Everything after the first colon, whitespace trimmed. May be empty. */
	value: string;
};

/**
 * Splits `text` on its first colon. The fullwidth colon wins over the halfwidth
 * one so that "政治面貌：中共党员" and "政治面貌:中共党员" behave identically.
 * Returns `undefined` when there is no colon at all, which means the field is
 * not a "label: value" pair and must be rendered verbatim.
 */
export function parseCnFieldText(text: string): ParsedCnField | undefined {
	const fullwidthIndex = text.indexOf(FULLWIDTH_COLON);
	const index = fullwidthIndex >= 0 ? fullwidthIndex : text.indexOf(HALFWIDTH_COLON);
	if (index < 0) return undefined;

	const label = text.slice(0, index).trim();
	const value = text.slice(index + 1).trim();
	if (label.length === 0) return undefined;

	return { label, value };
}

/**
 * Resolves the semantic key of a custom field.
 *
 * Resolution order:
 *   1. `field.key` — populated once A2 lands; takes effect with no template change.
 *   2. Prefix sniffing on `field.text` against {@link CN_FIELD_LABELS}.
 *
 * Returns `undefined` when neither yields a known key. Callers MUST then fall
 * back to rendering the field verbatim, which is exactly what all 15 existing
 * templates do — sniffing can never lose information.
 */
export function resolveCnFieldKey(field: CustomField): CnFieldKey | undefined {
	const explicitKey = (field as { key?: unknown }).key;
	if (typeof explicitKey === "string" && CN_FIELD_KEY_SET.has(explicitKey)) {
		return explicitKey as CnFieldKey;
	}

	const parsed = parseCnFieldText(field.text ?? "");
	if (!parsed) return undefined;

	return LABEL_TO_KEY.get(normalizeLabel(parsed.label));
}

export type CnFieldPartition = {
	/** Claimed fields, at most one per key, in `wanted` order of first appearance. */
	slots: Partial<Record<CnFieldKey, CustomField>>;
	/** Everything that was not claimed. Render these through the generic path. */
	rest: CustomField[];
};

/**
 * Splits custom fields into recognised slots and the remainder.
 *
 * - Only keys listed in `wanted` are claimed, so a template can opt into a
 *   subset (e.g. skip the more sensitive marital status / height).
 * - A claimed field is removed from `rest`, so it is never rendered twice.
 * - A field whose key is already taken stays in `rest` — duplicates are never
 *   silently dropped.
 * - Sniffing failures land in `rest` too: behaviour degrades to the existing
 *   "render everything" contract instead of breaking.
 */
export function partitionCnFields(fields: readonly CustomField[], wanted: readonly CnFieldKey[]): CnFieldPartition {
	const wantedSet: ReadonlySet<CnFieldKey> = new Set(wanted);
	const slots: Partial<Record<CnFieldKey, CustomField>> = {};
	const rest: CustomField[] = [];

	for (const field of fields) {
		if (wantedSet.size === 0) {
			rest.push(field);
			continue;
		}

		const key = resolveCnFieldKey(field);
		if (key === undefined || !wantedSet.has(key) || slots[key] !== undefined) {
			rest.push(field);
			continue;
		}

		slots[key] = field;
	}

	return { slots, rest };
}
