import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";

/**
 * Shared chrome for the two public legal pages (`/privacy`, `/terms`).
 *
 * Both pages sit under `_home`, so the fixed marketing header has to be cleared by the page itself,
 * and both carry the skip-link target `#main-content` that `_home/route.tsx` renders for them.
 */

type LegalHeadOptions = {
	/** The public path of the document, used for the canonical URL. */
	path: string;
	title: string;
	description: string;
};

const DEFAULT_ORIGIN = "https://rxresu.me";

/**
 * Builds the `head()` payload for a legal route. The origin falls back during server rendering,
 * where there is no `window` to read the deployment's real host from.
 */
export function createLegalDocumentHead({ path, title, description }: LegalHeadOptions) {
	const origin = typeof window === "undefined" ? DEFAULT_ORIGIN : window.location.origin;
	const canonicalUrl = new URL(path, origin).toString();
	const imageUrl = new URL("/opengraph/banner.jpg", origin).toString();

	return {
		meta: [
			{ title },
			{ name: "description", content: description },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			{ property: "og:type", content: "article" },
			{ property: "og:image", content: imageUrl },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:url", content: canonicalUrl },
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
			{ name: "twitter:image", content: imageUrl },
		],
		links: [{ rel: "canonical", href: canonicalUrl }],
	};
}

type LegalDocumentShellProps = {
	title: ReactNode;
	intro: ReactNode;
	children: ReactNode;
};

export function LegalDocumentShell({ title, intro, children }: LegalDocumentShellProps) {
	const version = legalDocumentVersion;

	return (
		// The marketing header is `fixed` and 65px tall, so the page makes its own room.
		<main id="main-content" className="relative pt-20 lg:pt-24">
			<div className="container mx-auto px-4 sm:px-6 lg:px-12">
				<div className="border-border border-x pb-16">
					<header className="space-y-4 border-border border-b p-4 md:p-8">
						<h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>

						<p className="max-w-3xl text-muted-foreground text-sm leading-relaxed md:text-base">{intro}</p>

						<p className="font-medium text-muted-foreground text-xs">
							{/* The version doubles as the effective date: bumping it is what invalidates consent. */}
							<Trans comment="Published effective date of a legal document, followed by the version date">
								Effective date: {version}
							</Trans>
						</p>
					</header>

					{children}
				</div>
			</div>
		</main>
	);
}

type LegalSectionProps = {
	heading: ReactNode;
	children: ReactNode;
};

export function LegalSection({ heading, children }: LegalSectionProps) {
	return (
		<section className="border-border border-t p-4 md:p-8">
			<h2 className="font-semibold text-lg tracking-tight">{heading}</h2>

			<div className="mt-3 max-w-3xl space-y-3 text-muted-foreground text-sm leading-relaxed">{children}</div>
		</section>
	);
}

type LegalListProps = {
	children: ReactNode;
};

export function LegalList({ children }: LegalListProps) {
	return <ul className="list-disc space-y-1.5 ps-5">{children}</ul>;
}
