import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	BrainIcon,
	BriefcaseIcon,
	ChatCircleDotsIcon,
	GearSixIcon,
	MagnifyingGlassIcon,
	MegaphoneIcon,
	ReadCvLogoIcon,
	SealCheckIcon,
	ShieldCheckIcon,
	UserCircleIcon,
	UserGearIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Badge } from "@reactive-resume/ui/components/badge";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
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
	useSidebarState,
} from "@reactive-resume/ui/components/sidebar";
import { getInitials } from "@reactive-resume/utils/string";
import { Copyright } from "@/components/ui/copyright";
import { useCommandPaletteStore } from "@/features/command-palette/store";
import { UserDropdownMenu } from "@/features/user/dropdown-menu";
import { authClient } from "@/libs/auth/client";
import { orpc } from "@/libs/orpc/client";

/** Route context for the dashboard tree: carries the root's feature flags without refetching. */
const dashboardRoute = getRouteApi("/dashboard");

type SidebarItem = {
	icon: React.ReactNode;
	label: MessageDescriptor;
	href: React.ComponentProps<typeof Link>["to"];
	/** Optional counter beside the label — how many submissions are waiting on this admin. */
	badge?: number;
};

const appSidebarItems = [
	{
		icon: <ReadCvLogoIcon />,
		label: msg`Resumes`,
		href: "/dashboard/resumes",
	},
	{
		icon: <BriefcaseIcon />,
		label: msg`Applications`,
		href: "/dashboard/applications",
	},
	{
		icon: <ChatCircleDotsIcon />,
		label: msg`Agents`,
		href: "/agent",
	},
	{
		icon: <SealCheckIcon />,
		label: msg`ATS Checker`,
		href: "/ats-checker",
	},
] as const satisfies SidebarItem[];

const settingsSidebarItems = [
	{
		icon: <UserCircleIcon />,
		label: msg`Profile`,
		href: "/dashboard/settings/profile",
	},
	{
		icon: <GearSixIcon />,
		label: msg`Preferences`,
		href: "/dashboard/settings/preferences",
	},
	{
		icon: <ShieldCheckIcon />,
		label: msg`Authentication`,
		href: "/dashboard/settings/authentication",
	},
	{
		icon: <BrainIcon />,
		label: msg`Integrations`,
		href: "/dashboard/settings/integrations",
	},
	{
		icon: <UserGearIcon />,
		label: msg`Account`,
		href: "/dashboard/settings/account",
	},
] as const satisfies SidebarItem[];

const adminSidebarItems = [
	{
		icon: <ShieldCheckIcon />,
		label: msg`Admin Console`,
		href: "/admin/overview",
	},
] as const satisfies SidebarItem[];

/**
 * The board lives outside the dashboard but is reached from here, so the entry exists — and is
 * hidden — purely on the instance flag, with no request of its own: `flags` is already part of
 * the root router context every dashboard route inherits.
 */
const jobBoardSidebarItem = {
	icon: <MegaphoneIcon />,
	label: msg`Campus jobs`,
	href: "/jobs",
} as const satisfies SidebarItem;

/** Where the reader's own submissions and bookmarks live. */
const myPostsSidebarItem = {
	icon: <BriefcaseIcon />,
	label: msg`My campus posts`,
	href: "/dashboard/recruitment",
} as const satisfies SidebarItem;

/** The review queue, with the number of submissions waiting on it. */
const recruitmentReviewSidebarItem = {
	icon: <MegaphoneIcon />,
	label: msg`Recruitment Review`,
	href: "/admin/recruitment",
} as const satisfies SidebarItem;

type SidebarItemListProps = {
	items: readonly SidebarItem[];
};

function SidebarItemList({ items }: SidebarItemListProps) {
	const { i18n } = useLingui();

	return (
		<SidebarMenu>
			{items.map((item) => (
				<SidebarMenuItem key={item.href}>
					<SidebarMenuButton
						title={i18n.t(item.label)}
						render={
							<Link to={item.href} activeProps={{ className: "bg-sidebar-accent" }}>
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
			))}
		</SidebarMenu>
	);
}

function SidebarSearchButton() {
	const { i18n } = useLingui();
	const setOpen = useCommandPaletteStore((state) => state.setOpen);

	const label = i18n.t(msg`Search`);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton title={label} tooltip={label} onClick={() => setOpen(true)}>
				<MagnifyingGlassIcon />
				<span className="flex-1 text-start transition-[margin,opacity] duration-200 ease-in-out group-data-[collapsible=icon]:-ms-8 group-data-[collapsible=icon]:opacity-0">
					{label}
				</span>
				<Kbd className="transition-opacity duration-200 ease-in-out group-data-[collapsible=icon]:opacity-0">⌘K</Kbd>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function DashboardSidebar() {
	const { i18n } = useLingui();
	const { state } = useSidebarState();
	const { data: session } = authClient.useSession();
	const { flags } = dashboardRoute.useRouteContext();

	const boardEnabled = flags?.recruitmentBoardEnabled === true;

	// App items are built per render because two of them depend on the instance flag.
	const appItems = boardEnabled ? [...appSidebarItems, myPostsSidebarItem, jobBoardSidebarItem] : appSidebarItems;

	// The console route itself re-checks the role, this only decides whether the
	// shortcut is offered.
	const isAdmin = session?.user.role === "admin";

	// Only the total is read, so the queue's size costs a single row — and it is not requested
	// at all unless this reader is an administrator on an instance with the board switched on,
	// because the endpoint answers 403 for everyone else.
	const pending = useQuery({
		...orpc.admin.recruitment.posts.list.queryOptions({ input: { status: "pending", limit: 1, offset: 0 } }),
		enabled: isAdmin && boardEnabled,
		select: (data) => data.total,
	});

	const adminItems = boardEnabled
		? [...adminSidebarItems, { ...recruitmentReviewSidebarItem, badge: pending.data ?? 0 }]
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

					<SidebarSearchButton />
				</SidebarMenu>
			</SidebarHeader>

			<SidebarSeparator />

			<SidebarContent aria-label={i18n.t(msg`Dashboard`)} role="navigation">
				<SidebarGroup>
					<SidebarGroupLabel>
						<Trans>App</Trans>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarItemList items={appItems} />
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>
						<Trans>Settings</Trans>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarItemList items={settingsSidebarItems} />
					</SidebarGroupContent>
				</SidebarGroup>

				{isAdmin && (
					<SidebarGroup>
						<SidebarGroupLabel>
							<Trans>Administration</Trans>
						</SidebarGroupLabel>
						<SidebarGroupContent>
							<SidebarItemList items={adminItems} />
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>

			<SidebarSeparator />

			<SidebarFooter className="gap-y-0">
				<SidebarMenu>
					<SidebarMenuItem>
						<UserDropdownMenu>
							{({ session }) => (
								<SidebarMenuButton className="h-auto gap-x-3 group-data-[collapsible=icon]:p-1!">
									<Avatar className="size-8 shrink-0 transition-all group-data-[collapsible=icon]:size-6">
										<AvatarImage src={session.user.image ?? undefined} />
										<AvatarFallback className="group-data-[collapsible=icon]:text-[0.5rem]">
											{getInitials(session.user.name)}
										</AvatarFallback>
									</Avatar>

									<div className="transition-[margin,opacity] duration-200 ease-in-out group-data-[collapsible=icon]:-ms-8 group-data-[collapsible=icon]:opacity-0">
										<p className="font-medium">{session.user.name}</p>
										<p className="text-muted-foreground text-xs">{session.user.email}</p>
									</div>
								</SidebarMenuButton>
							)}
						</UserDropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>

				<AnimatePresence>
					{state === "expanded" && (
						<m.div
							key="copyright"
							className="will-change-[transform,opacity]"
							initial={{ y: 12, opacity: 0 }}
							animate={{ y: 0, opacity: 1 }}
							exit={{ y: 12, opacity: 0 }}
							transition={{ duration: 0.2, ease: "easeOut" }}
						>
							<Copyright className="wrap-break-word shrink-0 whitespace-normal p-2" />
						</m.div>
					)}
				</AnimatePresence>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
