import type {
	Batch,
	Benefit,
	ContactKind,
	EducationRequired,
	EmploymentType,
	RecruitmentSource,
	WorkIntensity,
	WorkMode,
} from "@reactive-resume/schema/recruitment/data";
import type { RecruitmentPostCreateInput, RecruitmentPostOwner, RecruitmentPostUpdateInput } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	BATCHES,
	BENEFITS,
	CONTACT_KINDS,
	EDUCATION_REQUIREMENTS,
	EMPLOYMENT_TYPES,
	SOURCES,
	WORK_INTENSITIES,
	WORK_MODES,
} from "@reactive-resume/schema/recruitment/data";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";
import { toRecruitmentFailure } from "../errors";
import {
	batchLabels,
	benefitLabels,
	contactKindLabels,
	educationLabels,
	employmentTypeLabels,
	sourceLabels,
	workIntensityLabels,
	workModeLabels,
} from "../labels";

/** Server-side cap on `summary`, mirrored so the field stops at the same place the DTO does. */
const MAX_SUMMARY_CHARS = 2_000;

type FormState = {
	company: string;
	role: string;
	companyLogoUrl: string;
	batch: Batch;
	employmentType: EmploymentType[];
	workMode: WorkMode[];
	workIntensity: WorkIntensity[];
	locations: string;
	educationRequired: EducationRequired[];
	benefits: Benefit[];
	tags: string;
	salaryText: string;
	deadline: string;
	rolling: boolean;
	applyUrl: string;
	source: RecruitmentSource | null;
	sourceUrl: string;
	contactKind: ContactKind | null;
	contactValue: string;
	referralCode: string;
	summary: string;
};

const emptyForm = (): FormState => ({
	company: "",
	role: "",
	companyLogoUrl: "",
	batch: "regular",
	employmentType: ["campus"],
	workMode: [],
	workIntensity: [],
	locations: "",
	educationRequired: [],
	benefits: [],
	tags: "",
	salaryText: "",
	deadline: "",
	rolling: false,
	applyUrl: "",
	source: null,
	sourceUrl: "",
	contactKind: null,
	contactValue: "",
	referralCode: "",
	summary: "",
});

/** Editable fields of an existing row, so 「编辑」 pre-fills rather than starting blank. */
function toForm(post: RecruitmentPostOwner): FormState {
	return {
		company: post.company,
		role: post.role,
		companyLogoUrl: post.companyLogoUrl ?? "",
		batch: post.batch,
		employmentType: [...post.employmentType],
		workMode: [...post.workMode],
		workIntensity: [...post.workIntensity],
		locations: post.locations.join(", "),
		educationRequired: [...post.educationRequired],
		benefits: [...post.benefits],
		tags: post.tags.join(", "),
		salaryText: post.salaryText ?? "",
		deadline: post.deadline ? new Date(post.deadline).toISOString().slice(0, 10) : "",
		rolling: post.rolling,
		applyUrl: post.applyUrl ?? "",
		source: post.source,
		sourceUrl: post.sourceUrl ?? "",
		contactKind: post.contact?.kind ?? null,
		contactValue: post.contact?.value ?? "",
		referralCode: post.contact?.referralCode ?? "",
		summary: post.summary ?? "",
	};
}

/** "Beijing, Shanghai " → ["Beijing", "Shanghai"], capped the way the DTO caps it. */
function toList(value: string, max: number): string[] {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.slice(0, max);
}

type Editable = Omit<RecruitmentPostCreateInput, "company" | "role">;

/**
 * The form state as the server's editable field set.
 *
 * Every optional field is omitted rather than sent empty: `update` treats a present field as
 * "change this", and an empty string is a change to empty, not "leave it alone".
 */
function toEditable(state: FormState): Editable {
	const contactValue = state.contactValue.trim();

	return {
		batch: state.batch,
		employmentType: state.employmentType,
		workMode: state.workMode,
		workIntensity: state.workIntensity,
		locations: toList(state.locations, 10),
		educationRequired: state.educationRequired,
		benefits: state.benefits,
		tags: toList(state.tags, 10),
		rolling: state.rolling,
		summary: state.summary.trim(),
		...(state.companyLogoUrl.trim() ? { companyLogoUrl: state.companyLogoUrl.trim() } : {}),
		...(state.salaryText.trim() ? { salaryText: state.salaryText.trim() } : {}),
		...(state.applyUrl.trim() ? { applyUrl: state.applyUrl.trim() } : {}),
		...(state.sourceUrl.trim() ? { sourceUrl: state.sourceUrl.trim() } : {}),
		...(state.source !== null ? { source: state.source } : {}),
		...(state.referralCode.trim() ? { referralCode: state.referralCode.trim() } : {}),
		// A rolling post has no deadline by definition; an empty field means "none given".
		...(state.rolling || state.deadline === "" ? {} : { deadline: new Date(`${state.deadline}T00:00:00`) }),
		...(state.contactKind !== null && contactValue ? { contactKind: state.contactKind, contactValue } : {}),
	};
}

/** The two cross-field rules the database cannot express, checked before the round trip. */
function validate(state: FormState): string | null {
	if (state.company.trim().length === 0 || state.role.trim().length === 0) {
		return t`Company and role are both required.`;
	}

	if (state.employmentType.length === 0) return t`Pick at least one recruitment type.`;
	if (state.applyUrl.trim().length === 0 && state.sourceUrl.trim().length === 0) {
		return t`Add either an application link or a link to the original announcement.`;
	}

	if ((state.contactKind === null) !== (state.contactValue.trim().length === 0)) {
		return t`Pick a contact channel and fill in its value — the two go together.`;
	}

	if (!state.rolling && state.deadline !== "" && new Date(`${state.deadline}T00:00:00`).getTime() <= Date.now()) {
		return t`The deadline has to be in the future.`;
	}

	return null;
}

type PostFormSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The row being edited, or null for a new submission. */
	post: RecruitmentPostOwner | null;
	/** Whether submissions wait for an administrator before they appear on the board. */
	requireReview: boolean;
	/** Fired when the server answers that submissions are off, so the entry point can vanish. */
	onSubmissionDisabled?: () => void;
};

/**
 * 提交 / 编辑岗位 — the one place a user writes to the board.
 *
 * Two behaviours here are dictated by the server rather than chosen for the form:
 *
 * 1. **A duplicate is a dead end with a way out.** `create` answers 409 with the id of the
 *    post already holding the dedupe key, so the sheet stays open, says so, and links to it —
 *    the reader wanted that opening, and it already exists.
 * 2. **Editing a published post re-queues it.** The server drops it back to `pending`
 *    (§4.3.7) so an approval cannot become a permanent bypass; the form says this *before*
 *    the reader saves, because discovering it afterwards reads as data loss.
 */
export function PostFormSheet({ open, onOpenChange, post, requireReview, onSubmissionDisabled }: PostFormSheetProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();

	const [form, setForm] = useState<FormState>(emptyForm);
	const [error, setError] = useState<string | null>(null);
	const [duplicateId, setDuplicateId] = useState<string | null>(null);

	// Re-seeded whenever a different row is opened, so 「编辑」 never shows the previous one.
	useEffect(() => {
		if (!open) return;
		setForm(post === null ? emptyForm() : toForm(post));
		setError(null);
		setDuplicateId(null);
	}, [open, post]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.mine.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.list.queryKey() });
	};

	const onError = (thrown: unknown) => {
		const failure = toRecruitmentFailure(thrown);

		// Submission switched off: tell the caller so the entry point disappears rather than
		// offering a form that can only fail.
		if (failure.submissionDisabled) {
			onSubmissionDisabled?.();
			onOpenChange(false);
			toast.add({ type: "error", description: failure.message });
			return;
		}

		setError(failure.message);
		setDuplicateId(failure.existingPostId);
	};

	const create = useMutation(
		orpc.recruitment.create.mutationOptions({
			onSuccess: () => {
				invalidate();
				onOpenChange(false);
				toast.add({
					type: "success",
					description: requireReview
						? t`Submitted. It appears on the board once an administrator approves it.`
						: t`Submitted. It is on the board now.`,
				});
			},
			onError,
		}),
	);

	const update = useMutation(
		orpc.recruitment.update.mutationOptions({
			onSuccess: () => {
				invalidate();
				onOpenChange(false);
				toast.add({
					type: "success",
					// Editing anything live re-queues it, so the copy has to say where it went.
					description:
						post?.status === "published"
							? t`Saved. Your edit is back in the review queue — it stays on the board after an administrator approves it.`
							: t`Saved. It is back in the review queue.`,
				});
			},
			onError,
		}),
	);

	const isPending = create.isPending || update.isPending;

	const submit = () => {
		const problem = validate(form);
		if (problem !== null) {
			setError(problem);
			setDuplicateId(null);
			return;
		}

		const editable = toEditable(form);

		if (post === null) {
			create.mutate({ company: form.company.trim(), role: form.role.trim(), ...editable });
			return;
		}

		const input: RecruitmentPostUpdateInput = { id: post.id, ...editable };
		update.mutate(input);
	};

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setForm((prev) => ({ ...prev, ...({ [key]: value } as Pick<FormState, K>) }));

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="w-full sm:max-w-2xl">
				<SheetHeader>
					<SheetTitle>
						{post === null ? <Trans>Share a campus opening</Trans> : <Trans>Edit this opening</Trans>}
					</SheetTitle>
					<SheetDescription>
						{requireReview ? (
							<Trans>An administrator reviews every submission before it appears on the board.</Trans>
						) : (
							<Trans>Submissions appear on the board straight away.</Trans>
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-4">
					<div className="grid gap-4 sm:grid-cols-2">
						{post?.status === "published" && (
							<div className="sm:col-span-2">
								<Alert>
									<AlertTitle>
										<Trans>Editing sends this post back for review</Trans>
									</AlertTitle>
									<AlertDescription>
										<Trans>
											It stays on the board while an administrator looks at your changes, and goes back up once they
											approve them.
										</Trans>
									</AlertDescription>
								</Alert>
							</div>
						)}

						<Field label={t`Company`} htmlFor="post-company">
							<Input
								id="post-company"
								value={form.company}
								onChange={(event) => set("company", event.target.value)}
								placeholder={i18n._(t`Who is hiring`)}
							/>
						</Field>

						<Field label={t`Role`} htmlFor="post-role">
							<Input
								id="post-role"
								value={form.role}
								onChange={(event) => set("role", event.target.value)}
								placeholder={i18n._(t`What the job is`)}
							/>
						</Field>

						<Field label={t`Batch`} htmlFor="post-batch">
							<Combobox
								id="post-batch"
								options={BATCHES.map((value) => ({ value, label: i18n.t(batchLabels[value]) }))}
								value={form.batch}
								onValueChange={(value) => value !== null && set("batch", value)}
							/>
						</Field>

						<Field label={t`Recruitment type`} htmlFor="post-employment-type">
							<Combobox
								id="post-employment-type"
								multiple
								options={EMPLOYMENT_TYPES.map((value) => ({ value, label: i18n.t(employmentTypeLabels[value]) }))}
								value={form.employmentType}
								onValueChange={(value) => set("employmentType", value ?? [])}
							/>
						</Field>

						<Field label={t`Work mode`} htmlFor="post-work-mode">
							<Combobox
								id="post-work-mode"
								multiple
								options={WORK_MODES.map((value) => ({ value, label: i18n.t(workModeLabels[value]) }))}
								value={form.workMode}
								onValueChange={(value) => set("workMode", value ?? [])}
							/>
						</Field>

						<Field label={t`Work intensity`} htmlFor="post-work-intensity">
							<Combobox
								id="post-work-intensity"
								multiple
								options={WORK_INTENSITIES.map((value) => ({ value, label: i18n.t(workIntensityLabels[value]) }))}
								value={form.workIntensity}
								onValueChange={(value) => set("workIntensity", value ?? [])}
							/>
						</Field>

						<Field label={t`Education`} htmlFor="post-education">
							<Combobox
								id="post-education"
								multiple
								options={EDUCATION_REQUIREMENTS.map((value) => ({ value, label: i18n.t(educationLabels[value]) }))}
								value={form.educationRequired}
								onValueChange={(value) => set("educationRequired", value ?? [])}
							/>
						</Field>

						<Field label={t`Benefits`} htmlFor="post-benefits">
							<Combobox
								id="post-benefits"
								multiple
								options={BENEFITS.map((value) => ({ value, label: i18n.t(benefitLabels[value]) }))}
								value={form.benefits}
								onValueChange={(value) => set("benefits", value ?? [])}
							/>
						</Field>

						<Field label={t`Locations`} htmlFor="post-locations" hint={t`Separate cities with commas.`}>
							<Input
								id="post-locations"
								value={form.locations}
								onChange={(event) => set("locations", event.target.value)}
								placeholder={i18n._(t`Beijing, Shanghai`)}
							/>
						</Field>

						<Field label={t`Tags`} htmlFor="post-tags" hint={t`Separate tags with commas.`}>
							<Input
								id="post-tags"
								value={form.tags}
								onChange={(event) => set("tags", event.target.value)}
								placeholder={i18n._(t`Frontend, 2027 graduation`)}
							/>
						</Field>

						<Field label={t`Salary`} htmlFor="post-salary">
							<Input
								id="post-salary"
								value={form.salaryText}
								onChange={(event) => set("salaryText", event.target.value)}
								placeholder={i18n._(t`200-300/day`)}
							/>
						</Field>

						<Field label={t`Deadline`} htmlFor="post-deadline">
							<Input
								id="post-deadline"
								type="date"
								value={form.deadline}
								disabled={form.rolling}
								onChange={(event) => set("deadline", event.target.value)}
							/>
						</Field>

						<div className="flex items-center gap-x-2 sm:col-span-2">
							<Checkbox
								id="post-rolling"
								checked={form.rolling}
								onCheckedChange={(checked) => set("rolling", checked === true)}
							/>
							<Label htmlFor="post-rolling">
								<Trans>Applications are accepted indefinitely</Trans>
							</Label>
						</div>

						<Field label={t`Application link`} htmlFor="post-apply-url">
							<Input
								id="post-apply-url"
								value={form.applyUrl}
								onChange={(event) => set("applyUrl", event.target.value)}
								placeholder="https://"
							/>
						</Field>

						<Field label={t`Original announcement`} htmlFor="post-source-url">
							<Input
								id="post-source-url"
								value={form.sourceUrl}
								onChange={(event) => set("sourceUrl", event.target.value)}
								placeholder="https://"
							/>
						</Field>

						<Field label={t`Where this came from`} htmlFor="post-source">
							<Combobox
								id="post-source"
								options={SOURCES.map((value) => ({ value, label: i18n.t(sourceLabels[value]) }))}
								value={form.source}
								onValueChange={(value) => set("source", value)}
							/>
						</Field>

						<Field label={t`Contact channel`} htmlFor="post-contact-kind">
							<Combobox
								id="post-contact-kind"
								options={CONTACT_KINDS.map((value) => ({ value, label: i18n.t(contactKindLabels[value]) }))}
								value={form.contactKind}
								onValueChange={(value) => set("contactKind", value)}
							/>
						</Field>

						<Field label={t`Contact value`} htmlFor="post-contact-value">
							<Input
								id="post-contact-value"
								value={form.contactValue}
								onChange={(event) => set("contactValue", event.target.value)}
								placeholder={i18n._(t`WeChat handle, email address or phone number`)}
							/>
						</Field>

						<Field label={t`Referral code`} htmlFor="post-referral">
							<Input
								id="post-referral"
								value={form.referralCode}
								onChange={(event) => set("referralCode", event.target.value)}
							/>
						</Field>

						<Field
							className="sm:col-span-2"
							label={t`Summary`}
							htmlFor="post-summary"
							hint={<Trans>Plain text only.</Trans>}
						>
							<Textarea
								id="post-summary"
								rows={5}
								maxLength={MAX_SUMMARY_CHARS}
								value={form.summary}
								onChange={(event) => set("summary", event.target.value)}
								placeholder={i18n._(t`What the team does and who they are looking for`)}
							/>
						</Field>
					</div>

					{error !== null && (
						<Alert variant="destructive" className="mt-4">
							<AlertTitle>
								<Trans>This could not be saved.</Trans>
							</AlertTitle>
							<AlertDescription>
								<span className="block">{error}</span>
								{duplicateId !== null && (
									<Button variant="link" className="mt-1 h-auto p-0" nativeButton={false}>
										<Link to="/jobs/$postId" params={{ postId: duplicateId }}>
											<ArrowSquareOutIcon />
											<Trans>Open the post that already exists</Trans>
										</Link>
									</Button>
								)}
							</AlertDescription>
						</Alert>
					)}
				</div>

				<SheetFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button disabled={isPending} onClick={submit}>
						{post === null ? <Trans>Submit</Trans> : <Trans>Save changes</Trans>}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

type FieldProps = {
	label: string;
	htmlFor: string;
	/** A node, not a string: an interpolated `t` inside a component body upsets `tsgo`. */
	hint?: React.ReactNode;
	className?: string;
	children: React.ReactNode;
};

/** Label + control + optional hint, so every row in the grid lines up the same way. */
function Field({ label, htmlFor, hint, className, children }: FieldProps) {
	return (
		<div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{hint !== undefined && <p className="text-muted-foreground text-xs">{hint}</p>}
		</div>
	);
}
