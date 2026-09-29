// @vitest-environment happy-dom

import type { RecruitmentSearch } from "./use-recruitment-filters";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { defaultRecruitmentSearch, toRecruitmentListInput, useRecruitmentFilters } from "./use-recruitment-filters";

/**
 * These tests pin §5.3's mapping table: every URL parameter has to land on the field the DTO
 * expects, and a change that drops or renames one here is a silent filter regression in the UI.
 */
describe("toRecruitmentListInput", () => {
	it("sends the documented defaults for an unfiltered page", () => {
		expect(toRecruitmentListInput(defaultRecruitmentSearch)).toEqual({
			sortBy: "publishedAt",
			sortOrder: "desc",
			limit: 20,
			offset: 0,
		});
	});

	it("maps each scalar filter onto its own DTO field", () => {
		const input = toRecruitmentListInput({
			...defaultRecruitmentSearch,
			search: "engineer",
			role: "frontend",
			batch: "early",
			availability: "closingSoon",
			sortBy: "deadline",
			sortOrder: "asc",
		});

		expect(input).toMatchObject({
			search: "engineer",
			role: "frontend",
			batch: "early",
			availability: "closingSoon",
			sortBy: "deadline",
			sortOrder: "asc",
		});
	});

	it("maps multi-selects onto array fields and omits the empty ones", () => {
		const input = toRecruitmentListInput({
			...defaultRecruitmentSearch,
			employmentType: ["campus", "internship"],
			workMode: ["remote"],
			educationRequired: ["bachelor"],
			benefits: ["meal_allowance"],
			locations: ["Beijing"],
		});

		expect(input).toMatchObject({
			employmentType: ["campus", "internship"],
			workMode: ["remote"],
			educationRequired: ["bachelor"],
			benefits: ["meal_allowance"],
			locations: ["Beijing"],
		});

		expect(toRecruitmentListInput(defaultRecruitmentSearch)).not.toHaveProperty("employmentType");
		expect(toRecruitmentListInput(defaultRecruitmentSearch)).not.toHaveProperty("locations");
	});

	it("turns the page number into a limit/offset window", () => {
		expect(toRecruitmentListInput({ ...defaultRecruitmentSearch, page: 3 })).toMatchObject({
			limit: 20,
			offset: 40,
		});

		expect(toRecruitmentListInput({ ...defaultRecruitmentSearch, page: 1 })).toMatchObject({ offset: 0 });
	});
});

describe("useRecruitmentFilters", () => {
	let search = defaultRecruitmentSearch;
	let setSearch = vi.fn();

	beforeEach(() => {
		search = defaultRecruitmentSearch;
		setSearch = vi.fn();
	});

	// Mirrors the route: the hook receives *current* URL state and writes patches back to it.
	const renderFilters = () =>
		renderHook(() => {
			const [state, setState] = useState<RecruitmentSearch>(search);

			return useRecruitmentFilters({
				search: state,
				setSearch: (patch) => {
					setSearch(patch);
					setState((prev) => ({ ...prev, ...patch }));
				},
			});
		});

	it("returns the reader to page 1 when a filter changes", () => {
		const { result } = renderFilters();

		act(() => result.current.patch({ availability: "rolling" }));

		expect(setSearch).toHaveBeenCalledWith({ availability: "rolling", page: 1 });
	});

	it("writes multi-select values under the matching key", () => {
		const { result } = renderFilters();

		act(() => result.current.setArrayFilter("benefits", ["insurance_5"]));

		expect(setSearch).toHaveBeenCalledWith({ benefits: ["insurance_5"], page: 1 });
	});

	it("debounces typed search text instead of writing every keystroke", () => {
		vi.useFakeTimers();

		try {
			const { result } = renderFilters();

			act(() => result.current.setSearchDraft("front"));
			act(() => result.current.setSearchDraft("frontend"));

			expect(setSearch).not.toHaveBeenCalled();

			act(() => void vi.advanceTimersByTime(300));

			expect(setSearch).toHaveBeenCalledTimes(1);
			expect(setSearch).toHaveBeenCalledWith({ search: "frontend", page: 1 });
			expect(result.current.searchDraft).toBe("frontend");
		} finally {
			vi.useRealTimers();
		}
	});

	it("clears every filter back to the defaults", () => {
		const { result } = renderFilters();

		act(() => result.current.reset());

		expect(setSearch).toHaveBeenCalledWith(defaultRecruitmentSearch);
	});

	it("builds the query input from the URL state it was given", () => {
		const { result } = renderFilters();

		expect(result.current.input).toEqual({
			sortBy: "publishedAt",
			sortOrder: "desc",
			limit: 20,
			offset: 0,
		});
	});

	it("reports whether any narrowing filter is active", () => {
		const { result } = renderFilters();
		expect(result.current.hasActiveFilters).toBe(false);

		act(() => result.current.setArrayFilter("locations", ["Shanghai"]));
		expect(result.current.hasActiveFilters).toBe(true);
	});
});
