import { Trans } from "@lingui/react/macro";
import { m } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { wrap } from "./classes";

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;

const metaLinkClass = "text-(--home-ink) underline-offset-[3px] hover:underline";

export function SiteFooter() {
	return (
		<footer id="footer" className="relative isolate z-1 overflow-clip border-(--home-line) border-t">
			{/* Warm light pooling under the wordmark, echoing the parallax planes behind the page. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 -z-1 h-[78%] bg-[radial-gradient(125%_100%_at_50%_100%,rgb(196_166_140/13%)_0%,rgb(166_143_184/7%)_36%,transparent_70%)]"
			/>

			<div
				className={cn(
					wrap,
					"flex items-center justify-between gap-x-8 gap-y-3 pt-[76px] text-[#87878d] text-[12px] max-[700px]:flex-col max-[700px]:items-start max-[540px]:pt-[52px]",
				)}
			>
				<p>
					<Trans>By the community, for the community.</Trans>
					<br />
					<Trans>
						Released under the{" "}
						<a href={licenseUrl} target="_blank" rel="noopener noreferrer" className={metaLinkClass}>
							MIT License
						</a>
						.
					</Trans>
				</p>
				<p>
					<Trans>
						A passion project by{" "}
						<a href="https://amruthpillai.com" target="_blank" rel="noopener noreferrer" className={metaLinkClass}>
							Amruth Pillai
						</a>
					</Trans>
					<span aria-hidden="true" className="px-2 text-(--home-line)">
						/
					</span>
					<bdi className="tabular-nums">v{__APP_VERSION__}</bdi>
				</p>
			</div>

			{/* Oversized wordmark, cropped by the footer edge so it reads as a watermark rather than a heading. */}
			<div className={cn(wrap, "@container mt-10 max-[540px]:mt-7")}>
				<m.p
					aria-hidden="true"
					className="select-none bg-gradient-to-b from-(--home-ink) from-45% to-[rgb(241_240_235/7%)] bg-clip-text font-[Manrope_Variable,sans-serif] font-bold text-[14.4cqw] text-transparent leading-[0.78] tracking-[-0.07em]"
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, amount: 0.3 }}
					transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}
				>
					Reactive Resume
				</m.p>
			</div>
		</footer>
	);
}
