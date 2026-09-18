import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "./-components/placeholder";

export const Route = createFileRoute("/admin/audit")({
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Audit Log · Admin" }] }),
});

function RouteComponent() {
	const { i18n } = useLingui();

	return (
		<AdminPlaceholder
			title={i18n._(msg`Audit Log`)}
			description={i18n._(msg`Who changed what, and when, across the admin console.`)}
		/>
	);
}
