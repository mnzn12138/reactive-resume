import type { MessageDescriptor } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { cn } from "@reactive-resume/utils/style";

type EnumBadgeListProps<TValue extends string> = {
	values: readonly TValue[];
	/** Used to resolve each value's label through the active catalogue. */
	labels: Record<TValue, MessageDescriptor>;
	/** Extra values are folded into a "+N" counter rather than wrapping the row. */
	max?: number;
	className?: string;
};

/**
 * Cycled so neighbouring badges stay visually distinct without per-badge styling decisions.
 * Index-based (not value-based) because the same value must look the same from row to row.
 */
const badgeVariants = ["secondary", "outline", "default"] as const;

/**
 * Renders an array of enum values as a group of badges.
 *
 * Zero-config by design: callers hand over the values and the label map, and both the copy and
 * the colours follow. Capping with "+N" keeps a five-benefit post from pushing the rest of the
 * column off screen — in a list you scan rather than read, that beats completeness.
 */
export function EnumBadgeList<TValue extends string>({
	values,
	labels,
	max = 3,
	className,
}: EnumBadgeListProps<TValue>) {
	const { i18n } = useLingui();

	if (values.length === 0) {
		return <span className="text-muted-foreground text-xs">—</span>;
	}

	const visible = values.slice(0, max);
	const overflow = values.length - visible.length;

	return (
		<span className={cn("flex flex-wrap items-center gap-1", className)}>
			{visible.map((value, index) => (
				<Badge key={value} variant={badgeVariants[index % badgeVariants.length]}>
					{i18n.t(labels[value])}
				</Badge>
			))}

			{overflow > 0 && <span className="text-muted-foreground text-xs">{t`+${overflow}`}</span>}
		</span>
	);
}
