import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";

type CompanyLogoProps = {
	/** Used for the monogram fallback and as the logo's alternate text. */
	company: string;
	logoUrl: string | null;
	className?: string;
};

/**
 * Company avatar: the uploaded logo when there is one, the company's initials otherwise.
 *
 * The fallback is deliberately a monogram rather than a generic building icon — in a list of
 * thirty hiring companies, thirty identical grey icons carry no information, while two letters
 * let the eye find "ByteDance" again without reading the row.
 */
export function CompanyLogo({ company, logoUrl, className }: CompanyLogoProps) {
	const initials = getInitials(company);

	if (logoUrl) {
		return (
			<img
				src={logoUrl}
				alt={company}
				loading="lazy"
				className={cn("size-8 rounded-md border bg-background object-contain p-0.5", className)}
			/>
		);
	}

	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted font-medium text-[0.625rem] text-muted-foreground uppercase",
				className,
			)}
		>
			{initials}
		</span>
	);
}
