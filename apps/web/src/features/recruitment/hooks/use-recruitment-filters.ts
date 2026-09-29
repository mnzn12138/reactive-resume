import type { RecruitmentListInput } from "../types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import z from "zod";
import {
	RECRUITMENT_PAGE_SIZE,
	recruitmentAvailabilityOptions,
	recruitmentBatchOptions,
	recruitmentBenefitOptions,
	recruitmentEducationOptions,
	recruitmentEmploymentTypeOptions,
	recruitmentSortOptions,
	recruitmentWorkModeOptions,
} from "@reactive-resume/api/features/recruitment/options";

/**
 * URL ⇄ filter state for the campus recruitment board — §5.3 of
 * `plans/46-campus-board-design.md`.
 *
 * Every option list is imported from the single source of truth instead of being written out
 * again: a value the `<select>` offers but the zod schema rejects would turn a filter into a
 * page-wide 400, which is the one failure mode a dropdown hides perfectly.
 *
 * `sortBy` is narrowed to the server's whitelist for the same reason — the DTO turns anything
 * else into a validation error rather than falling back to a default.
 */

/** Rows per page. Taken from the shared bounds so the paginator cannot disagree with the DTO. */
export const recruitmentPageSize = RECRUITMENT_PAGE_SIZE.default;

export const recruitmentSearchSchema = z.object({
	search: z.string().default(""),
	role: z.string().default(""),
	batch: z.enum(recruitmentBatchOptions).optional(),
	employmentType: z.array(z.enum(recruitmentEmploymentTypeOptions)).default([]),
	workMode: z.array(z.enum(recruitmentWorkModeOptions)).default([]),
	educationRequired: z.array(z.enum(recruitmentEducationOptions)).default([]),
	benefits: z.array(z.enum(recruitmentBenefitOptions)).default([]),
	locations: z.array(z.string()).default([]),
	availability: z.enum(recruitmentAvailabilityOptions).optional(),
	sortBy: z.enum(recruitmentSortOptions).default("publishedAt"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	page: z.number().int().min(1).default(1),
});

export type RecruitmentSearch = z.output<typeof recruitmentSearchSchema>;

export const defaultRecruitmentSearch: RecruitmentSearch = {
	search: "",
	role: "",
	employmentType: [],
	workMode: [],
	educationRequired: [],
	benefits: [],
	locations: [],
	sortBy: "publishedAt",
	sortOrder: "desc",
	page: 1,
};

/** Keys holding multi-select arrays, so one setter can drive every "OR within a field" control. */
type ArrayFilterKey = {
	[K in keyof RecruitmentSearch]: RecruitmentSearch[K] extends string[] ? K : never;
}[keyof RecruitmentSearch];

const TEXT_DEBOUNCE_MS = 300;

/**
 * Translate URL state into the list query's input — the mapping in §5.3.
 *
 * Empty filters are dropped rather than sent as empty arrays: every field is optional on the
 * wire, and an empty array narrows the result set to nothing on some backends.
 */
export function toRecruitmentListInput(
	filters: RecruitmentSearch,
	pageSize: number = recruitmentPageSize,
): RecruitmentListInput {
	return {
		...(filters.search ? { search: filters.search } : {}),
		...(filters.role ? { role: filters.role } : {}),
		...(filters.batch ? { batch: filters.batch } : {}),
		...(filters.employmentType.length > 0 ? { employmentType: [...filters.employmentType] } : {}),
		...(filters.workMode.length > 0 ? { workMode: [...filters.workMode] } : {}),
		...(filters.educationRequired.length > 0 ? { educationRequired: [...filters.educationRequired] } : {}),
		...(filters.benefits.length > 0 ? { benefits: [...filters.benefits] } : {}),
		...(filters.locations.length > 0 ? { locations: [...filters.locations] } : {}),
		...(filters.availability ? { availability: filters.availability } : {}),
		sortBy: filters.sortBy,
		sortOrder: filters.sortOrder,
		limit: pageSize,
		offset: (filters.page - 1) * pageSize,
	};
}

/**
 * A text input backed by a debounced URL parameter.
 *
 * The keystrokes stay local so typing is never blocked by a navigation, and the URL catches up
 * once typing settles. `lastPushed` remembers what this input last wrote, so an external change
 * to the same parameter — the browser's back button, or "clear filters" — resets the visible
 * text without racing the user mid-word.
 */
function useDebouncedParam(urlValue: string, commit: (value: string) => void, delay = TEXT_DEBOUNCE_MS) {
	const [draft, setDraft] = useState(urlValue);
	const lastPushed = useRef(urlValue);

	useEffect(() => {
		if (urlValue === lastPushed.current) return;

		lastPushed.current = urlValue;
		setDraft(urlValue);
	}, [urlValue]);

	useEffect(() => {
		if (draft === urlValue) return;

		const timer = setTimeout(() => {
			lastPushed.current = draft;
			commit(draft);
		}, delay);

		return () => clearTimeout(timer);
	}, [commit, delay, draft, urlValue]);

	return [draft, setDraft] as const;
}

export type RecruitmentFiltersController = ReturnType<typeof useRecruitmentFilters>;

type UseRecruitmentFiltersArgs = {
	search: RecruitmentSearch;
	setSearch: (patch: Partial<RecruitmentSearch>) => void;
};

/**
 * Bundles every filter control with the URL write that backs it.
 *
 * Any change other than paging returns the reader to page 1 — otherwise changing "open → rolling"
 * on page 4 either shows nothing or silently skips rows.
 */
export function useRecruitmentFilters({ search, setSearch }: UseRecruitmentFiltersArgs) {
	const patch = useCallback(
		(next: Partial<RecruitmentSearch>) => {
			setSearch("page" in next ? next : { ...next, page: 1 });
		},
		[setSearch],
	);

	/** Writes a whole multi-select's values under its own key; OR within the field, AND across fields. */
	const setArrayFilter = useCallback(
		(key: ArrayFilterKey, values: string[]) => {
			// Keys are a closed set, but TypeScript needs `string` here to accept a computed name;
			// the cast below is the single place that bridging happens.
			patch({ [key as string]: values } as unknown as Partial<RecruitmentSearch>);
		},
		[patch],
	);

	const commitSearch = useCallback((value: string) => patch({ search: value }), [patch]);
	const commitRole = useCallback((value: string) => patch({ role: value }), [patch]);

	const [searchDraft, setSearchDraft] = useDebouncedParam(search.search, commitSearch);
	const [roleDraft, setRoleDraft] = useDebouncedParam(search.role, commitRole);

	const reset = useCallback(() => setSearch({ ...defaultRecruitmentSearch }), [setSearch]);

	const input = useMemo(() => toRecruitmentListInput(search), [search]);

	const hasActiveFilters =
		search.search.length > 0 ||
		search.role.length > 0 ||
		search.batch !== undefined ||
		search.availability !== undefined ||
		search.employmentType.length > 0 ||
		search.workMode.length > 0 ||
		search.educationRequired.length > 0 ||
		search.benefits.length > 0 ||
		search.locations.length > 0;

	return {
		filters: search,
		input,
		hasActiveFilters,
		patch,
		reset,
		setArrayFilter,
		searchDraft,
		setSearchDraft,
		roleDraft,
		setRoleDraft,
	};
}
