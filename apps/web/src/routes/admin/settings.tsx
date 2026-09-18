import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { createFileRoute } from "@tanstack/react-router";
import { AdminPlaceholder } from "./-components/placeholder";

export const Route = createFileRoute("/admin/settings")({
	component: RouteComponent,
	head: () => ({ meta: [{ title: "Settings · Admin" }] }),
});

function RouteComponent() {
	const { i18n } = useLingui();

	return (
		<AdminPlaceholder
			title={i18n._(msg`Settings`)}
			description={i18n._(msg`Override instance-wide feature flags at runtime.`)}
		/>
	);
}
