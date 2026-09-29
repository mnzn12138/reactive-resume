import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, MegaphoneIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";

type JobsShellProps = {
	children: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	/** True when root context carried a session; decides which way the header button points. */
	isAuthenticated: boolean;
};

/**
 * Page frame for `/jobs`.
 *
 * The board is not under `/dashboard`, so it gets no sidebar and no marketing header: this
 * minimal masthead is the only way back home for someone who opened a shared link directly.
 */
export function JobsShell({ children, title, description, isAuthenticated }: JobsShellProps) {
	return (
		<div className="min-h-svh bg-background">
			<header className="border-b">
				<nav className="mx-auto flex max-w-6xl items-center gap-x-3 px-4 py-3">
					<Link to="/" className="transition-opacity hover:opacity-80" aria-label="Reactive Resume">
						<BrandIcon className="size-8" />
					</Link>

					<span className="flex items-center gap-x-1.5 font-medium text-sm">
						<MegaphoneIcon className="text-muted-foreground" />
						<Trans>Campus jobs</Trans>
					</span>

					<Button
						size="sm"
						variant="outline"
						className="ms-auto"
						nativeButton={false}
						render={
							<Link to={isAuthenticated ? "/dashboard" : "/auth/login"}>
								{isAuthenticated ? <Trans>Dashboard</Trans> : <Trans>Log in</Trans>}
								<ArrowRightIcon />
							</Link>
						}
					/>
				</nav>
			</header>

			<Separator />

			<main className="mx-auto max-w-6xl space-y-4 px-4 py-6" id="main-content">
				<div className="space-y-1">
					<h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
					{description !== undefined && <p className="text-muted-foreground text-sm">{description}</p>}
				</div>

				{children}
			</main>
		</div>
	);
}
