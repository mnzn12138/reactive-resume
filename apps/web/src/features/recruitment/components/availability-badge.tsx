import type { Availability } from "@reactive-resume/schema/recruitment/data";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { cn } from "@reactive-resume/utils/style";
import { availabilityLabels } from "../labels";

type AvailabilityBadgeProps = {
	/** Server-derived freshness — never recomputed here, per §5.4's warning. */
	availability: Availability;
	/** Whole days left before the deadline, or null when rolling / no deadline. */
	daysUntilDeadline: number | null;
	/** Set false in tight layouts that already carry the countdown elsewhere. */
	showCountdown?: boolean;
	className?: string;
};

/**
 * Colour carries the urgency so a scan finds expiring posts without reading every cell.
 *
 * `expired` is rendered but is not reachable from the public list without `includeExpired`;
 * it exists here because a bookmark or a stale link can still land on a closed post's page.
 */
const variantByAvailability = {
	open: "secondary",
	closingSoon: "destructive",
	rolling: "outline",
	expired: "outline",
} as const;

/**
 * Freshness badge for one post.
 *
 * The countdown string is only shown when the server supplied a day count: `rolling` posts have
 * no deadline by definition, and guessing one from `deadline` in the browser would drift from
 * the server's timezone — the exact disagreement the derived field exists to prevent.
 */
export function AvailabilityBadge({
	availability,
	daysUntilDeadline,
	showCountdown = true,
	className,
}: AvailabilityBadgeProps) {
	const { i18n } = useLingui();

	const label = i18n.t(availabilityLabels[availability]);
	const countdown = showCountdown ? toCountdown(i18n, availability, daysUntilDeadline) : null;

	return (
		<span className={cn("inline-flex items-center gap-x-1.5", className)} data-testid="availability-badge">
			<Badge variant={variantByAvailability[availability]}>{label}</Badge>

			{countdown !== null && <span className="text-muted-foreground text-xs tabular-nums">{countdown}</span>}
		</span>
	);
}

function toCountdown(i18n: ReturnType<typeof useLingui>["i18n"], availability: Availability, days: number | null) {
	if (days === null) return null;
	if (availability !== "open" && availability !== "closingSoon") return null;
	if (days <= 0) return i18n._(msg`Closes today`);

	return i18n._(plural(days, { one: "# day left", other: "# days left" }));
}
