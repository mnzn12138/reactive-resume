import type { basicsSchema, CustomFieldKey } from "@reactive-resume/schema/resume/data";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DotsSixVerticalIcon, LinkIcon, ListPlusIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Reorder, useDragControls } from "motion/react";
import { customFieldKeyLabels, customFieldKeySeparator } from "@reactive-resume/schema/resume/data";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { FormControl, FormItem } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { generateId } from "@reactive-resume/utils/string";
import { IconPicker } from "@/components/input/icon-picker";
import { withForm } from "@/libs/tanstack-form";

type FormValues = z.infer<typeof basicsSchema>;
type CustomField = FormValues["customFields"][number];

/**
 * Domestic (mainland China) field types offered as one-click additions.
 *
 * The label is user data, not UI copy: it is what lands in `customField.text`
 * and therefore what the PDF renders. The `key` is what makes the field
 * machine readable for templates such as xuanwu, which lift these into their
 * personal information band even if the user later rewords the text.
 */
const domesticFieldOptions = (Object.entries(customFieldKeyLabels) as [CustomFieldKey, readonly string[]][]).flatMap(
	([key, labels]) => {
		const label = labels[0];
		if (label === undefined) return [];
		return [{ key, label }];
	},
);

const defaultValues: FormValues = {
	name: "",
	headline: "",
	email: "",
	phone: "",
	location: "",
	website: { url: "", label: "" },
	customFields: [],
};

export const CustomFieldsSection = withForm({
	defaultValues,
	render: ({ form }) => {
		return (
			<form.Field name="customFields" mode="array">
				{(customFieldsField) => (
					<Reorder.Group
						className="touch-none space-y-4"
						values={customFieldsField.state.value}
						onReorder={(fields) => {
							customFieldsField.setValue(fields);
						}}
					>
						{customFieldsField.state.value.map((field: CustomField, index: number) => (
							<CustomFieldItem key={field.id} field={field}>
								<form.Field name={`customFields[${index}].icon`}>
									{(iconField) => (
										<FormItem className="shrink-0">
											<FormControl
												render={
													<IconPicker
														name={iconField.name}
														value={iconField.state.value}
														className="rounded-r-none! border-e-0!"
														onChange={(icon) => {
															iconField.handleChange(icon);
														}}
													/>
												}
											/>
										</FormItem>
									)}
								</form.Field>

								<form.Field name={`customFields[${index}].text`}>
									{(textField) => (
										<FormItem className="flex-1">
											<FormControl
												render={
													<Input
														name={textField.name}
														value={textField.state.value}
														className="rounded-l-none!"
														onChange={(e) => {
															textField.handleChange(e.target.value);
														}}
													/>
												}
											/>
										</FormItem>
									)}
								</form.Field>

								<form.Field name={`customFields[${index}].link`}>
									{(linkField) => (
										<Popover>
											<PopoverTrigger
												render={
													<Button size="icon" variant="ghost" aria-label={t`Add link`} className="ms-1">
														<LinkIcon />
													</Button>
												}
											/>

											<PopoverContent align="center">
												<div className="flex flex-col gap-y-1.5">
													<Label htmlFor={linkField.name} className="text-muted-foreground text-xs">
														<Trans>Enter the URL to link to</Trans>
													</Label>

													<Input
														type="url"
														value={linkField.state.value}
														id={linkField.name}
														placeholder={t({
															comment: "Placeholder text for custom link URL field in resume builder",
															message: "Must start with https://",
														})}
														onChange={(e) => {
															linkField.handleChange(e.target.value);
														}}
													/>
												</div>
											</PopoverContent>
										</Popover>
									)}
								</form.Field>

								<Button
									size="icon"
									variant="ghost"
									aria-label={t`Remove custom field`}
									onClick={() => {
										customFieldsField.removeValue(index);
									}}
								>
									<XIcon />
								</Button>
							</CustomFieldItem>
						))}

						<div className="flex items-center gap-x-1">
							<Button
								variant="ghost"
								onClick={() => {
									customFieldsField.pushValue({ id: generateId(), icon: "acorn", text: "", link: "" });
								}}
							>
								<ListPlusIcon />
								<Trans>Add a custom field</Trans>
							</Button>

							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button size="icon" variant="ghost" aria-label={t`Add a domestic field`}>
											<PlusIcon />
										</Button>
									}
								/>

								<DropdownMenuContent align="end">
									{domesticFieldOptions.map((option) => (
										<DropdownMenuItem
											key={option.key}
											onClick={() => {
												customFieldsField.pushValue({
													id: generateId(),
													icon: "user",
													key: option.key,
													text: `${option.label}${customFieldKeySeparator}`,
													link: "",
												});
											}}
										>
											{option.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</Reorder.Group>
				)}
			</form.Field>
		);
	},
});

type CustomFieldItemProps = {
	field: CustomField;
	children: React.ReactNode;
};

function CustomFieldItem({ field, children }: CustomFieldItemProps) {
	const controls = useDragControls();

	return (
		<Reorder.Item
			key={field.id}
			value={field}
			dragListener={false}
			dragControls={controls}
			initial={{ opacity: 0, y: -10 }}
			animate={{ opacity: 1, y: 0 }}
			className="flex touch-none items-center"
		>
			<Button
				size="icon"
				variant="ghost"
				aria-label={t`Reorder custom field`}
				className="me-2 touch-none"
				onPointerDown={(e) => {
					e.preventDefault();
					controls.start(e);
				}}
			>
				<DotsSixVerticalIcon />
			</Button>

			{children}
		</Reorder.Item>
	);
}
