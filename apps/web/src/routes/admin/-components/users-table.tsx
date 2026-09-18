import type { OnChangeFn, PaginationState, SortingState } from "@reactive-resume/ui/components/data-table";
import type { RouterOutput } from "@/libs/orpc/client";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	DetectiveIcon,
	DotsThreeVerticalIcon,
	ProhibitIcon,
	ShieldCheckIcon,
	TrashIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { InputGroup, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";

type AdminUser = RouterOutput["admin"]["users"]["list"]["items"][number];

type Props = {
	users: AdminUser[];
	total: number;
	isLoading: boolean;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	sorting: SortingState;
	onSortingChange: OnChangeFn<SortingState>;
	emptyMessage: string;
	/** The signed-in administrator, so the row can disable actions against itself. */
	currentUserId?: string | undefined;
};

const columnHelper = createColumnHelper<AdminUser>();

export function UsersTable({
	users,
	total,
	isLoading,
	pagination,
	onPaginationChange,
	sorting,
	onSortingChange,
	emptyMessage,
	currentUserId,
}: Props) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
	const [banReason, setBanReason] = useState("");
	const [banExpiresAt, setBanExpiresAt] = useState("");

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.admin.users.list.queryKey() });
	};

	const onError = () => toast.add({ type: "error", description: t`Something went wrong. Please try again.` });

	const setRole = useMutation(orpc.admin.users.setRole.mutationOptions({ onSuccess: invalidate, onError }));
	const setBan = useMutation(
		orpc.admin.users.setBan.mutationOptions({
			onSuccess: () => {
				setBanTarget(null);
				setBanReason("");
				setBanExpiresAt("");
				invalidate();
			},
			onError,
		}),
	);
	const remove = useMutation(orpc.admin.users.delete.mutationOptions({ onSuccess: invalidate, onError }));

	// Kept stable so the column definitions below don't rebuild on every render.
	const handleDelete = useCallback(
		async (target: AdminUser) => {
			const confirmed = await confirm(t`Delete this account?`, {
				description: t`${target.email} and everything they own — resumes, cover letters and applications — will be permanently deleted. This can't be undone.`,
				confirmText: t`Delete`,
			});
			if (confirmed) remove.mutate({ id: target.id });
		},
		[confirm, remove.mutate],
	);

	const submitBan = () => {
		if (!banTarget) return;
		setBan.mutate({
			id: banTarget.id,
			banned: true,
			...(banReason ? { reason: banReason } : {}),
			...(banExpiresAt ? { expiresAt: new Date(banExpiresAt) } : {}),
		});
	};

	const columns = useMemo(
		() => [
			columnHelper.accessor("name", {
				header: t`Name`,
				cell: (info) => (
					<div className="flex flex-col">
						<span className="font-medium">{info.getValue()}</span>
						<span className="text-muted-foreground text-xs">{info.row.original.email}</span>
					</div>
				),
			}),
			columnHelper.accessor("role", {
				header: t`Role`,
				cell: (info) => (
					<Badge variant={info.getValue() === "admin" ? "default" : "secondary"}>
						{info.getValue() === "admin" ? i18n._(msg`Admin`) : i18n._(msg`User`)}
					</Badge>
				),
			}),
			columnHelper.accessor("banned", {
				header: t`Status`,
				cell: (info) =>
					info.getValue() ? (
						<Badge variant="destructive">
							<Trans>Banned</Trans>
						</Badge>
					) : (
						<span className="text-muted-foreground text-xs">
							<Trans>Active</Trans>
						</span>
					),
			}),
			columnHelper.accessor("lastActiveAt", {
				header: t`Last active`,
				cell: (info) =>
					info.getValue() ? (
						<span className="text-muted-foreground text-xs">{i18n.date(info.getValue() as Date)}</span>
					) : (
						<span className="text-muted-foreground text-xs">—</span>
					),
			}),
			columnHelper.accessor("createdAt", {
				header: t`Created`,
				cell: (info) => <span className="text-muted-foreground text-xs">{i18n.date(info.getValue())}</span>,
			}),
			columnHelper.display({
				id: "actions",
				header: () => <span className="sr-only">{t`Actions`}</span>,
				cell: (info) => {
					const target = info.row.original;
					const isSelf = target.id === currentUserId;
					const isAdmin = target.role === "admin";

					return (
						<div className="flex justify-end">
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
									<DotsThreeVerticalIcon />
									<span className="sr-only">{t`Actions`}</span>
								</DropdownMenuTrigger>

								<DropdownMenuContent align="end">
									<DropdownMenuItem
										disabled={isSelf || setRole.isPending}
										onClick={() => setRole.mutate({ id: target.id, role: isAdmin ? "user" : "admin" })}
									>
										{isAdmin ? <UserIcon /> : <ShieldCheckIcon />}
										{isAdmin ? <Trans>Demote to user</Trans> : <Trans>Promote to admin</Trans>}
									</DropdownMenuItem>

									{target.banned ? (
										<DropdownMenuItem
											disabled={isSelf || setBan.isPending}
											onClick={() => setBan.mutate({ id: target.id, banned: false })}
										>
											<DetectiveIcon />
											<Trans>Lift ban</Trans>
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem disabled={isSelf} onClick={() => setBanTarget(target)}>
											<ProhibitIcon />
											<Trans>Ban user</Trans>
										</DropdownMenuItem>
									)}

									<DropdownMenuSeparator />

									<DropdownMenuItem
										variant="destructive"
										disabled={isSelf || remove.isPending}
										onClick={() => void handleDelete(target)}
									>
										<TrashIcon />
										<Trans>Delete account</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				},
			}),
		],
		[
			currentUserId,
			handleDelete,
			i18n,
			remove.isPending,
			setBan.mutate,
			setBan.isPending,
			setRole.mutate,
			setRole.isPending,
		],
	);

	return (
		<>
			<DataTable
				columns={columns}
				data={users}
				isLoading={isLoading}
				emptyMessage={emptyMessage}
				rowCount={total}
				pagination={pagination}
				onPaginationChange={onPaginationChange}
				sorting={sorting}
				onSortingChange={onSortingChange}
			/>

			<Dialog open={banTarget !== null} onOpenChange={(open) => !open && setBanTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							<Trans>Ban this account?</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>They will be signed out everywhere and unable to sign back in until the ban is lifted.</Trans>
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="ban-reason">
								<Trans>Reason</Trans>
							</Label>
							<Textarea
								id="ban-reason"
								value={banReason}
								onChange={(event) => setBanReason(event.target.value)}
								placeholder={t`Shown to other administrators`}
								rows={3}
							/>
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="ban-expires">
								<Trans>Lifts at (optional)</Trans>
							</Label>
							<InputGroup>
								<InputGroupInput
									id="ban-expires"
									type="datetime-local"
									value={banExpiresAt}
									onChange={(event) => setBanExpiresAt(event.target.value)}
								/>
							</InputGroup>
							<p className="text-muted-foreground text-xs">
								<Trans>Leave empty for a permanent ban.</Trans>
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setBanTarget(null)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button variant="destructive" disabled={setBan.isPending} onClick={submitBan}>
							<Trans>Ban user</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
