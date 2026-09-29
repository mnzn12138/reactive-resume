import type {
	Batch,
	Benefit,
	EducationRequired,
	EmploymentType,
	WorkMode,
} from "@reactive-resume/schema/recruitment/data";
import type { RecruitmentFiltersController, RecruitmentSearch } from "../hooks/use-recruitment-filters";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowDownIcon, ArrowUpIcon, FunnelSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
	recruitmentAvailabilityOptions,
	recruitmentBatchOptions,
	recruitmentBenefitOptions,
	recruitmentEducationOptions,
	recruitmentEmploymentTypeOptions,
	recruitmentSortOptions,
	recruitmentWorkModeOptions,
} from "@reactive-resume/api/features/recruitment/options";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Combobox } from "@/components/ui/combobox";
import {
	availabilityLabels,
	batchLabels,
	benefitLabels,
	educationLabels,
	employmentTypeLabels,
	sortLabels,
	workModeLabels,
} from "../labels";

type PostFiltersProps = {
	/** The controller returned by `useRecruitmentFilters` — every control writes through it. */
	controller: RecruitmentFiltersController;
	/** Matching rows across all pages, shown below the controls. */
	total: number;
};

/** Sentinel for "don't filter on this", so "no batch" stays representable. */
const ANY_VALUE = "any";

/**
 * Filter bar for the public board — the controls half of §5.3's mapping table.
 *
 * Every control writes to the URL rather than to component state, so a filtered view survives a
 * refresh and can be pasted into a group chat instead of evaporating on navigation.
 */
export function PostFilters({ controller, total }: PostFiltersProps) {
	const { i18n } = useLingui();
	const { filters, patch, reset, searchDraft, setSearchDraft, roleDraft, setRoleDraft } = controller;

	const options = useMemo(
		() => ({
			batch: [
				{ value: ANY_VALUE, label: t`Any batch` },
				...recruitmentBatchOptions.map((value) => ({ value, label: i18n.t(batchLabels[value]) })),
			],
			availability: [
				{ value: ANY_VALUE, label: t`Any status` },
				...recruitmentAvailabilityOptions.map((value) => ({ value, label: i18n.t(availabilityLabels[value]) })),
			],
			employmentType: recruitmentEmploymentTypeOptions.map((value) => ({
				value,
				label: i18n.t(employmentTypeLabels[value]),
			})),
			workMode: recruitmentWorkModeOptions.map((value) => ({ value, label: i18n.t(workModeLabels[value]) })),
			educationRequired: recruitmentEducationOptions.map((value) => ({
				value,
				label: i18n.t(educationLabels[value]),
			})),
			benefits: recruitmentBenefitOptions.map((value) => ({ value, label: i18n.t(benefitLabels[value]) })),
			sortBy: recruitmentSortOptions.map((value) => ({ value, label: i18n.t(sortLabels[value]) })),
		}),
		[i18n],
	);

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<InputGroup className="min-w-48 flex-1">
					<InputGroupAddon align="inline-start">
						<MagnifyingGlassIcon />
					</InputGroupAddon>
					<InputGroupInput
						value={searchDraft}
						onChange={(event) => setSearchDraft(event.target.value)}
						placeholder={t`Search roles`}
						aria-label={t`Search roles`}
					/>
				</InputGroup>

				<InputGroup className="w-full min-w-40 sm:w-40">
					<InputGroupInput
						value={roleDraft}
						onChange={(event) => setRoleDraft(event.target.value)}
						placeholder={t`Filter by role`}
						aria-label={t`Filter by role`}
					/>
				</InputGroup>

				<Combobox
					className="w-36 min-w-0"
					options={options.batch}
					value={filters.batch ?? ANY_VALUE}
					showClear={false}
					onValueChange={(value) => patch({ batch: !value || value === ANY_VALUE ? undefined : (value as Batch) })}
				/>

				<Combobox
					className="w-36 min-w-0"
					options={options.availability}
					value={filters.availability ?? ANY_VALUE}
					showClear={false}
					onValueChange={(value) =>
						patch({
							availability: !value || value === ANY_VALUE ? undefined : (value as RecruitmentSearch["availability"]),
						})
					}
				/>

				<Combobox
					multiple
					className="w-44 min-w-0"
					options={options.employmentType}
					value={filters.employmentType}
					placeholder={t`Any type`}
					onValueChange={(value) => controller.setArrayFilter("employmentType", (value ?? []) as EmploymentType[])}
				/>

				<Combobox
					multiple
					className="w-36 min-w-0"
					options={options.workMode}
					value={filters.workMode}
					placeholder={t`Any work mode`}
					onValueChange={(value) => controller.setArrayFilter("workMode", (value ?? []) as WorkMode[])}
				/>

				<Combobox
					multiple
					className="w-44 min-w-0"
					options={options.educationRequired}
					value={filters.educationRequired}
					placeholder={t`Any education`}
					onValueChange={(value) =>
						controller.setArrayFilter("educationRequired", (value ?? []) as EducationRequired[])
					}
				/>

				<Combobox
					multiple
					className="w-44 min-w-0"
					options={options.benefits}
					value={filters.benefits}
					placeholder={t`Any benefit`}
					onValueChange={(value) => controller.setArrayFilter("benefits", (value ?? []) as Benefit[])}
				/>

				<Combobox
					className="w-40 min-w-0"
					options={options.sortBy}
					value={filters.sortBy}
					showClear={false}
					onValueChange={(value) => value && patch({ sortBy: value as RecruitmentSearch["sortBy"] })}
				/>

				<Button
					size="icon"
					variant="outline"
					aria-label={filters.sortOrder === "asc" ? t`Sort descending` : t`Sort ascending`}
					onClick={() => patch({ sortOrder: filters.sortOrder === "asc" ? "desc" : "asc" })}
				>
					{filters.sortOrder === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
				</Button>

				{controller.hasActiveFilters && (
					<Button variant="ghost" size="sm" onClick={reset}>
						<XIcon />
						<Trans>Clear filters</Trans>
					</Button>
				)}
			</div>

			<LocationFilter controller={controller} />

			<p className="text-muted-foreground text-xs" data-testid="filters-result-count">
				{plural(total, { one: "# result", other: "# results" })}
			</p>
		</div>
	);
}

type LocationFilterProps = {
	controller: RecruitmentFiltersController;
};

/**
 * Free-text location filter.
 *
 * City names are free-form everywhere in this feature, so unlike the other multi-selects this
 * one cannot be a closed dropdown: anything typed and confirmed becomes a chip. Values go as-is,
 * and the server ORs within the field — the semantics §5.3 promises.
 */
function LocationFilter({ controller }: LocationFilterProps) {
	const [draft, setDraft] = useState("");

	const add = () => {
		const value = draft.trim();
		if (value.length === 0) return;

		const next = controller.filters.locations.includes(value)
			? controller.filters.locations
			: [...controller.filters.locations, value];

		controller.setArrayFilter("locations", next);
		setDraft("");
	};

	const remove = (location: string) => {
		controller.setArrayFilter(
			"locations",
			controller.filters.locations.filter((value) => value !== location),
		);
	};

	return (
		<div className="flex flex-wrap items-center gap-2">
			<InputGroup className="w-full min-w-40 sm:w-48">
				<InputGroupAddon align="inline-start">
					<FunnelSimpleIcon />
				</InputGroupAddon>
				<InputGroupInput
					value={draft}
					placeholder={t`Add location`}
					aria-label={t`Add location`}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						add();
					}}
				/>
			</InputGroup>

			{controller.filters.locations.map((location) => (
				<Badge key={location} variant="secondary" className="gap-x-1">
					{location}
					<button type="button" aria-label={t`Remove location`} onClick={() => remove(location)}>
						<XIcon className="size-3" />
					</button>
				</Badge>
			))}
		</div>
	);
}
