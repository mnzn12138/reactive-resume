import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";

type TrendPoint = {
	/** UTC day, as YYYY-MM-DD. */
	date: string;
	count: number;
};

type Props = {
	/** Oldest first; the server already fills empty days in with zero. */
	data: TrendPoint[];
};

/**
 * Hand-rolled SVG sparkline.
 *
 * The app deliberately ships no charting dependency, and a 30-point series with
 * no axes does not justify adding one.
 */
export function SignupTrend({ data }: Props) {
	const { i18n } = useLingui();

	const total = data.reduce((sum, day) => sum + day.count, 0);
	// Guard against an all-zero window, which would otherwise divide by zero.
	const peak = Math.max(1, ...data.map((day) => day.count));

	const width = 600;
	const height = 140;
	const inset = 6;

	const step = data.length > 1 ? (width - inset * 2) / (data.length - 1) : 0;
	const y = (count: number) => height - inset - (count / peak) * (height - inset * 2);

	const points = data.map((day, index) => `${inset + index * step},${y(day.count)}`);
	// Closed back along the baseline so the series can be filled as a single shape.
	const area = `${inset},${height - inset} ${points.join(" ")} ${width - inset},${height - inset}`;

	return (
		<section className="flex flex-col gap-3 rounded-lg border bg-background p-4">
			<div className="flex items-baseline justify-between gap-4">
				<div>
					<h2 className="font-medium text-sm">
						<Trans>Signups</Trans>
					</h2>
					<p className="text-muted-foreground text-xs">
						<Trans>Last 30 days</Trans>
					</p>
				</div>
				<span className="font-semibold text-lg tabular-nums">{total}</span>
			</div>

			<svg
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				className="h-32 w-full text-primary"
				role="img"
			>
				<title>{i18n._(t`Daily signups over the last 30 days`)}</title>
				<polygon points={area} fill="currentColor" opacity={0.12} />
				<polyline
					points={points.join(" ")}
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					// Keeps the stroke 1.5px even though the viewBox is stretched.
					vectorEffect="non-scaling-stroke"
				/>
			</svg>

			<div className="flex justify-between text-muted-foreground text-xs">
				<span>{data.at(0)?.date}</span>
				<span>{data.at(-1)?.date}</span>
			</div>
		</section>
	);
}
