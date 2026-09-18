import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "./-components/placeholder";

export const Route = createFileRoute("/admin/overview")({
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Overview · Admin" }] }),
});

function RouteComponent() {
	const { i18n } = useLingui();

	return (
		<AdminPlaceholder
			title={i18n._(msg`Overview`)}
			description={i18n._(msg`Instance-wide totals and signup trends for this deployment.`)}
		/>
	);
}
