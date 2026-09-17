import { m } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { wrap } from "./classes";

export function SiteFooter() {
	return (
		<footer
			id="footer"
			className="relative isolate z-1 overflow-clip border-(--home-line) border-t pt-[76px] max-[540px]:pt-[52px]"
		>
			{/* Warm light pooling under the wordmark, echoing the parallax planes behind the page. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 -z-1 h-[78%] bg-[radial-gradient(125%_100%_at_50%_100%,rgb(196_166_140/13%)_0%,rgb(166_143_184/7%)_36%,transparent_70%)]"
			/>

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
