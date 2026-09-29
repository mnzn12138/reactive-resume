import type { I18n, MessageDescriptor } from "@lingui/core";
import type { recruitmentSortOptions } from "@reactive-resume/api/features/recruitment/options";
import type {
	Availability,
	Batch,
	Benefit,
	ContactKind,
	EducationRequired,
	EmploymentType,
	RecruitmentSource,
	WorkIntensity,
	WorkMode,
} from "@reactive-resume/schema/recruitment/data";
import { msg } from "@lingui/core/macro";

/**
 * Chinese-campus-recruitment vocabulary, resolved through the active Lingui catalogue.
 *
 * Two rules shape this file:
 *
 * 1. **No enum lives here.** The values come from `packages/schema` (via the API `options`
 *    export where the web app needs the list itself), so a new value can never be offered by
 *    the API and unlabelled here without breaking `Record` exhaustiveness.
 * 2. **Every string goes through the `msg` macro**, never through a raw JSX literal — this
 *    app's default locale is Simplified Chinese, so an unextracted label surfaces as English.
 *
 * English msgids are deliberately descriptive rather than literal: 985/211, 提前批 and 补录
 * have no counterpart outside Chinese hiring, so the source strings explain them and the
 * `zh-CN` / `zh-TW` catalogues give the short local term.
 */

/** Message-descriptor maps, keyed by enum value. `Record<Enum, …>` keeps them exhaustive. */
export const batchLabels: Record<Batch, MessageDescriptor> = {
	early: msg`Early batch`,
	regular: msg`Regular batch`,
	supplementary: msg`Supplementary intake`,
};

export const employmentTypeLabels: Record<EmploymentType, MessageDescriptor> = {
	campus: msg`Campus`,
	internship: msg`Internship`,
	summerInternship: msg`Summer internship`,
	social: msg`Experienced hire`,
};

export const workModeLabels: Record<WorkMode, MessageDescriptor> = {
	onsite: msg`On-site`,
	hybrid: msg`Hybrid`,
	remote: msg`Remote`,
};

export const workIntensityLabels: Record<WorkIntensity, MessageDescriptor> = {
	standard: msg`Standard hours`,
	intensive: msg`Intensive`,
};

export const educationLabels: Record<EducationRequired, MessageDescriptor> = {
	"985_211": msg`985/211 bachelor's`,
	bachelor: msg`Bachelor's degree`,
	associate: msg`Associate degree`,
	upgraded: msg`Upgraded bachelor's`,
	no_92_requirement: msg`Open to all universities`,
	case_by_case: msg`Case by case`,
};

export const benefitLabels: Record<Benefit, MessageDescriptor> = {
	afternoon_tea: msg`Afternoon tea`,
	meal_allowance: msg`Meal allowance`,
	housing_allowance: msg`Housing allowance`,
	insurance_5: msg`Five insurances`,
	insurance_6: msg`Six insurances`,
	flexible_hours: msg`Flexible hours`,
	no_clock_in: msg`No clock-in`,
};

export const contactKindLabels: Record<ContactKind, MessageDescriptor> = {
	wechat: msg`WeChat`,
	email: msg`Email`,
	phone: msg`Phone`,
	referral: msg`Referral`,
};

export const sourceLabels: Record<RecruitmentSource, MessageDescriptor> = {
	official: msg`Official`,
	referral: msg`Internal referral`,
	community: msg`Community`,
};

export const availabilityLabels: Record<Availability, MessageDescriptor> = {
	open: msg`Open`,
	closingSoon: msg`Closing soon`,
	rolling: msg`Rolling`,
	expired: msg`Expired`,
};

/** Sort options mirror `recruitmentSortOptions`; unlike the lists above, order is the UI order. */
export const sortLabels: Record<(typeof recruitmentSortOptions)[number], MessageDescriptor> = {
	publishedAt: msg`Newest postings`,
	deadline: msg`Deadline`,
	createdAt: msg`Recently added`,
};

/** Resolve one enum value through the active catalogue. Generic so no map needs its own helper. */
export function enumLabel<TValue extends string>(
	i18n: I18n,
	labels: Record<TValue, MessageDescriptor>,
	value: TValue,
): string {
	return i18n.t(labels[value]);
}

/** Resolve a whole array of enum values, preserving order. Empty input → empty output. */
export function enumLabels<TValue extends string>(
	i18n: I18n,
	labels: Record<TValue, MessageDescriptor>,
	values: readonly TValue[],
): string[] {
	return values.map((value) => enumLabel(i18n, labels, value));
}
