import { Trans } from "@lingui/react/macro";
import { ProhibitIcon } from "@phosphor-icons/react";

type PlaceholderProps = {
	/** Shown as the page heading. */
	title: string;
	/** One line explaining what this section will do. */
	description: string;
};

/**
 * Stand-in for the admin sections that land in later phases (P1 users/resumes,
 * P3 overview + settings). Keeps the sidebar navigable without shipping
 * half-built screens.
 */
export const AdminPlaceholder = ({ title, description }: PlaceholderProps) => (
	<div className="flex flex-col gap-2">
		<h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
		<p className="text-muted-foreground text-sm">{description}</p>

		<div className="mt-6 flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
			<ProhibitIcon size={32} className="text-muted-foreground" />
			<p className="text-muted-foreground text-sm">
				<Trans>This section is not built yet.</Trans>
			</p>
		</div>
	</div>
);
