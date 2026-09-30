import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	ClipboardTextIcon,
	FileTextIcon,
	GaugeIcon,
	GearSixIcon,
	MegaphoneIcon,
	ReadCvLogoIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useRouterState } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
} from "@reactive-resume/ui/components/sidebar";
import { Copyright } from "@/components/ui/copyright";
import { orpc } from "@/libs/orpc/client";

/** Route context for the console: carries the root's feature flags without refetching. */
const adminRoute = getRouteApi("/admin");

type SidebarItem = {
	icon: React.ReactNode;
	label: MessageDescriptor;
	href: React.ComponentProps<typeof Link>["to"];
	/** Optional counter rendered beside the label — currently only the review queue uses it. */
	badge?: number;
};

const adminSidebarItems = [
	{ icon: <GaugeIcon />, label: msg`Overview`, href: "/admin/overview" },
	{ icon: <UsersThreeIcon />, label: msg`Users`, href: "/admin/users" },
	{ icon: <FileTextIcon />, label: msg`Resumes`, href: "/admin/resumes" },
	{ icon: <GearSixIcon />, label: msg`Settings`, href: "/admin/settings" },
	{ icon: <ClipboardTextIcon />, label: msg`Audit Log`, href: "/admin/audit" },
] as const satisfies SidebarItem[];

/** The review queue, offered only while the board itself is switched on. */
const recruitmentSidebarItem = {
	icon: <MegaphoneIcon />,
	label: msg`Recruitment Review`,
	href: "/admin/recruitment",
} as const satisfies SidebarItem;

export function AdminSidebar() {
	const { i18n } = useLingui();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { flags } = adminRoute.useRouteContext();

	// One row is enough: only the total is read, so the queue's size costs a single row.
	const pending = useQuery({
		...orpc.admin.recruitment.posts.list.queryOptions({
			input: { status: "pending", limit: 1, offset: 0 },
		}),
		enabled: flags?.recruitmentBoardEnabled === true,
		select: (data) => data.total,
	});

	const pendingCount = pending.data ?? 0;

	const items: SidebarItem[] = flags?.recruitmentBoardEnabled
		? [...adminSidebarItems, { ...recruitmentSidebarItem, badge: pendingCount }]
		: adminSidebarItems;

	return (
		<Sidebar variant="floating" collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="h-auto justify-center"
							render={
								<Link to="/">
									<BrandIcon variant="icon" className="size-6" />
									<h1 className="sr-only">Reactive Resume</h1>
								</Link>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			<SidebarSeparator />

			<SidebarContent aria-label={i18n.t(msg`Admin`)} role="navigation">
				<SidebarGroup>
					<SidebarGroupLabel>
						<Trans>Administration</Trans>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{items.map((item) => {
								const href = item.href ?? "";

								return (
									<SidebarMenuItem key={item.href}>
										<SidebarMenuButton
											title={i18n.t(item.label)}
											tooltip={i18n.t(item.label)}
											isActive={href.length > 0 && pathname.startsWith(href)}
											render={
												<Link to={item.href}>
													{item.icon}
													<span className="shrink-0 transition-[margin,opacity] duration-200 ease-in-out group-data-[collapsible=icon]:-ms-8 group-data-[collapsible=icon]:opacity-0">
														{i18n.t(item.label)}
													</span>
													{(item.badge ?? 0) > 0 && (
														<Badge
															variant="destructive"
															className="ms-auto tabular-nums transition-opacity duration-200 ease-in-out group-data-[collapsible=icon]:opacity-0"
														>
															{item.badge}
														</Badge>
													)}
												</Link>
											}
										/>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarSeparator />

			<SidebarFooter className="gap-y-0">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							title={i18n.t(msg`Back to dashboard`)}
							tooltip={i18n.t(msg`Back to dashboard`)}
							render={
								<Link to="/dashboard/resumes">
									<ReadCvLogoIcon />
									<span className="shrink-0 transition-[margin,opacity] duration-200 ease-in-out group-data-[collapsible=icon]:-ms-8 group-data-[collapsible=icon]:opacity-0">
										<Trans>Back to dashboard</Trans>
									</span>
								</Link>
							}
						/>
					</SidebarMenuItem>
				</SidebarMenu>

				<Copyright className="wrap-break-word shrink-0 whitespace-normal p-2" />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
