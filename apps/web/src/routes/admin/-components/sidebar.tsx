import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	ClipboardTextIcon,
	FileTextIcon,
	GaugeIcon,
	GearSixIcon,
	ReadCvLogoIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
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

type SidebarItem = {
	icon: React.ReactNode;
	label: MessageDescriptor;
	href: React.ComponentProps<typeof Link>["to"];
};

const adminSidebarItems = [
	{ icon: <GaugeIcon />, label: msg`Overview`, href: "/admin/overview" },
	{ icon: <UsersThreeIcon />, label: msg`Users`, href: "/admin/users" },
	{ icon: <FileTextIcon />, label: msg`Resumes`, href: "/admin/resumes" },
	{ icon: <GearSixIcon />, label: msg`Settings`, href: "/admin/settings" },
	{ icon: <ClipboardTextIcon />, label: msg`Audit Log`, href: "/admin/audit" },
] as const satisfies SidebarItem[];

export function AdminSidebar() {
	const { i18n } = useLingui();
	const pathname = useRouterState({ select: (state) => state.location.pathname });

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
							{adminSidebarItems.map((item) => (
								<SidebarMenuItem key={item.href}>
									<SidebarMenuButton
										title={i18n.t(item.label)}
										tooltip={i18n.t(item.label)}
										isActive={pathname.startsWith(item.href)}
										render={
											<Link to={item.href}>
												{item.icon}
												<span className="shrink-0 transition-[margin,opacity] duration-200 ease-in-out group-data-[collapsible=icon]:-ms-8 group-data-[collapsible=icon]:opacity-0">
													{i18n.t(item.label)}
												</span>
											</Link>
										}
									/>
								</SidebarMenuItem>
							))}
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
