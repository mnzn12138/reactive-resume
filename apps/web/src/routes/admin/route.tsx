import { Trans } from "@lingui/react/macro";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SidebarProvider } from "@reactive-resume/ui/components/sidebar";
import { createNoindexFollowMeta } from "@/libs/seo";
import { AdminSidebar } from "./-components/sidebar";

/**
 * Root of the admin console.
 *
 * `beforeLoad` is the only place the role is enforced on the client — the
 * server rejects every admin endpoint independently, so a hand-crafted
 * navigation here only ever reaches an empty page, never privileged data.
 */
export const Route = createFileRoute("/admin")({
	component: RouteComponent,
	beforeLoad: ({ context }) => {
		if (!context.session) throw redirect({ to: "/auth/login", replace: true });

		if (context.session.user.role !== "admin") {
			throw redirect({ to: "/dashboard/resumes", replace: true });
		}

		return { session: context.session };
	},
	head: () => ({
		meta: [createNoindexFollowMeta()],
	}),
});

function RouteComponent() {
	return (
		<SidebarProvider>
			<a
				href="#main-content"
				className="sr-only rounded-md bg-popover px-4 py-2 text-sm ring-2 ring-ring focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
			>
				<Trans>Skip to main content</Trans>
			</a>

			<AdminSidebar />

			<main id="main-content" className="@container flex-1 p-4 md:ps-2">
				<Outlet />
			</main>
		</SidebarProvider>
	);
}
