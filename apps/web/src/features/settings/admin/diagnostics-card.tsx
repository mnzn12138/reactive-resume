import type { MessageDescriptor } from "@lingui/core";
import type { RouterOutput } from "@/libs/orpc/client";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { orpc } from "@/libs/orpc/client";

type ChannelDiagnostics = RouterOutput["admin"]["diagnostics"]["get"]["channels"][number];
type ChannelId = ChannelDiagnostics["channel"];

const CHANNEL_COPY: Record<ChannelId, { label: MessageDescriptor; fix: MessageDescriptor }> = {
	wechat: {
		label: msg`WeChat sign-in`,
		fix: msg`Set WECHAT_APP_ID and WECHAT_APP_SECRET on the server, then restart it.`,
	},
	alipay: {
		label: msg`Alipay sign-in`,
		fix: msg`Set ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY and ALIPAY_PUBLIC_KEY on the server, then restart it.`,
	},
	sms: {
		label: msg`Phone number sign-in`,
		fix: msg`Set SMS_PROVIDER to aliyun or tencent and fill in that vendor's credentials, then restart the server.`,
	},
};

/**
 * `configured` and `disabledByFlag` are independent, so "wired up but closed on
 * purpose" is its own state — reporting it as merely broken would send an
 * operator hunting through environment variables that are fine.
 */
const STATUS_COPY = {
	enabled: msg`Enabled`,
	notConfigured: msg`Not configured`,
	disabled: msg`Closed by switch`,
} as const;

type Status = keyof typeof STATUS_COPY;

const statusOf = (channel: ChannelDiagnostics): Status => {
	if (!channel.configured) return "notConfigured";
	if (channel.disabledByFlag) return "disabled";
	return "enabled";
};

/**
 * Read-only view of the three domestic sign-in channels.
 *
 * Everything shown here comes from `admin.diagnostics.get`, which masks every
 * credential down to its last four characters. The last four are enough to
 * confirm *which* key the server loaded — which is the only question this card
 * exists to answer — and not enough to use it.
 *
 * The masked line is rendered in a monospace face on purpose: it is a dump of
 * what the server sees, not prose, and an operator should be able to read the
 * variable names off it without hunting.
 */
export function DiagnosticsCard() {
	const { i18n } = useLingui();
	const { data, isLoading } = useQuery(orpc.admin.diagnostics.get.queryOptions());

	if (isLoading || !data) return <Skeleton className="h-36 rounded-lg" />;

	return (
		<div className="flex flex-col gap-3">
			{data.channels.map((channel) => {
				const status = statusOf(channel);
				const copy = CHANNEL_COPY[channel.channel];

				return (
					<div key={channel.channel} className="flex flex-col gap-1.5 rounded-lg border bg-background p-4">
						<div className="flex items-start justify-between gap-4">
							<span className="font-medium text-sm">{i18n._(copy.label)}</span>

							<Badge variant={status === "enabled" ? "default" : "secondary"}>{i18n._(STATUS_COPY[status])}</Badge>
						</div>

						<p className="font-mono text-muted-foreground text-xs">{channel.preview}</p>

						{/* Structured, not just prose: the same names the operator has to paste into a `.env`. */}
						{channel.missing.length > 0 && (
							<p className="text-muted-foreground text-xs">
								<Trans>Missing:</Trans> <span className="font-mono">{channel.missing.join(", ")}</span>
							</p>
						)}

						{/* A dead channel is only useful if the card says what to do about it. */}
						{status !== "enabled" && <p className="text-muted-foreground text-xs">{i18n._(copy.fix)}</p>}
					</div>
				);
			})}
		</div>
	);
}
