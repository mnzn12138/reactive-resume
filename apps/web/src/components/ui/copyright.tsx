import { Trans } from "@lingui/react/macro";
import { cn } from "@reactive-resume/utils/style";

type Props = React.ComponentProps<"div">;

export function Copyright({ className, ...props }: Props) {
	return (
		<div className={cn("text-muted-foreground/80 text-xs leading-relaxed", className)} {...props}>
			<p>
				<Trans comment="App version label in footer; includes semantic version variable">
					Reactive Resume v<bdi>{__APP_VERSION__}</bdi>
				</Trans>
			</p>
		</div>
	);
}
