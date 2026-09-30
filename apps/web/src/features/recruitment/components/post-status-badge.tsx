import type { PostStatus } from "@reactive-resume/schema/recruitment/data";
import { useLingui } from "@lingui/react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { cn } from "@reactive-resume/utils/style";
import { statusLabels } from "../labels";

type PostStatusBadgeProps = {
	status: PostStatus;
	className?: string;
};

/**
 * `published` is the only state that needs a filled badge: in a list of the reader's own
 * submissions it is the one they are looking for, and in the review queue it marks the rows
 * that need no action.
 */
const variantByStatus = {
	draft: "outline",
	pending: "secondary",
	published: "default",
	rejected: "destructive",
	closed: "outline",
	expired: "outline",
} as const satisfies Record<PostStatus, "outline" | "secondary" | "default" | "destructive">;

/** Moderation state of one post, in the words the submitter sees. */
export function PostStatusBadge({ status, className }: PostStatusBadgeProps) {
	const { i18n } = useLingui();

	return (
		<Badge variant={variantByStatus[status]} className={cn(className)} data-testid="post-status-badge">
			{i18n.t(statusLabels[status])}
		</Badge>
	);
}
