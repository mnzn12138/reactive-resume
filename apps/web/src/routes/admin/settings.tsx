import type { MessageDescriptor } from "@lingui/core";
import type { RouterOutput } from "@/libs/orpc/client";
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

export const Route = createFileRoute("/admin/settings")({
	component: RouteComponent,
	head: () => ({ meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Settings`)} · ${i18n._(msg`Admin`)}` }] }),
});

type Setting = RouterOutput["admin"]["settings"]["get"]["settings"][number];
type SettingKey = Setting["key"];
type SettingSource = Setting["source"];

const SETTING_COPY: Record<SettingKey, { label: MessageDescriptor; description: MessageDescriptor }> = {
	disableSignups: {
		label: msg`Disable new signups`,
		description: msg`Stops new accounts from being created, including through social sign-in. Existing accounts keep working.`,
	},
	disableEmailAuth: {
		label: msg`Disable email and password authentication`,
		description: msg`Turns off email sign-in, email sign-up and password resets. Federated sign-in still works.`,
	},
};

const SOURCE_COPY: Record<SettingSource, MessageDescriptor> = {
	database: msg`Set in this console`,
	environment: msg`From an environment variable`,
	default: msg`Built-in default`,
};

function RouteComponent() {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const query = useQuery(orpc.admin.settings.get.queryOptions());

	const setSetting = useMutation(
		orpc.admin.settings.set.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.settings.get.queryKey() }),
			onError: () => toast.add({ type: "error", description: t`Could not save the setting. Please try again.` }),
		}),
	);

	if (query.isLoading || !query.data) {
		return (
			<div className="flex flex-col gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">
						<Trans>Settings</Trans>
					</h1>
					<p className="text-muted-foreground text-sm">
						<Trans>Override instance-wide feature flags at runtime.</Trans>
					</p>
				</div>

				<div className="flex flex-col gap-3">
					{Array.from({ length: 2 }).map((_, index) => (
						<Skeleton key={`setting-skeleton-${index}`} className="h-24 rounded-lg" />
					))}
				</div>
			</div>
		);
	}

	const { settings, smtpEnabled } = query.data;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Settings</Trans>
				</h1>
				<p className="text-muted-foreground text-sm">
					<Trans>Override instance-wide feature flags at runtime.</Trans>
				</p>
			</div>

			<div className="flex flex-col gap-3">
				{settings.map((setting) => (
					<div key={setting.key} className="flex items-start justify-between gap-6 rounded-lg border bg-background p-4">
						<div className="flex flex-col items-start gap-1.5">
							<span className="font-medium text-sm">{i18n._(SETTING_COPY[setting.key].label)}</span>
							<span className="text-muted-foreground text-xs">{i18n._(SETTING_COPY[setting.key].description)}</span>
							{/* The effective value can come from three places, and the console is the
							    only thing that can tell them apart. */}
							<Badge variant={setting.source === "database" ? "default" : "secondary"}>
								{i18n._(SOURCE_COPY[setting.source])}
							</Badge>
						</div>

						<Switch
							checked={setting.value}
							disabled={setSetting.isPending}
							onCheckedChange={(checked) => setSetting.mutate({ key: setting.key, value: checked })}
						/>
					</div>
				))}

				<div className="flex items-start justify-between gap-6 rounded-lg border border-dashed p-4">
					<div className="flex flex-col items-start gap-1.5">
						<span className="font-medium text-sm">
							<Trans>Outbound email</Trans>
						</span>
						<span className="text-muted-foreground text-xs">
							<Trans>
								Derived from whether SMTP is configured. Change the SMTP environment variables to turn it on or off.
							</Trans>
						</span>
					</div>

					<Badge variant="secondary">{smtpEnabled ? <Trans>Configured</Trans> : <Trans>Not configured</Trans>}</Badge>
				</div>
			</div>
		</div>
	);
}
