import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "./-components/placeholder";

export const Route = createFileRoute("/admin/resumes")({
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Resumes · Admin" }] }),
});

function RouteComponent() {
	const { i18n } = useLingui();

	return (
		<AdminPlaceholder
			title={i18n._(msg`Resumes`)}
			description={i18n._(msg`Find resumes across all accounts, lock or remove them.`)}
		/>
	);
}
