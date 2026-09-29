import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { legalDocumentRoutes } from "@reactive-resume/schema/legal";
import { createLegalDocumentHead, LegalDocumentShell, LegalList, LegalSection } from "./-sections/legal-document";

export const Route = createFileRoute("/_home/terms")({
	component: RouteComponent,
	head: () =>
		createLegalDocumentHead({
			path: legalDocumentRoutes.terms,
			title: t({
				comment: "Browser and social-card title of the terms of service page",
				message: "Terms of Service - Reactive Resume",
			}),
			description: t({
				comment: "Search-result description of the terms of service page",
				message:
					"The terms for using this Reactive Resume deployment: what the service is, what you are responsible for, and who owns what you write.",
			}),
		}),
});

function RouteComponent() {
	return (
		<LegalDocumentShell
			title={<Trans comment="Heading of the terms of service page">Terms of Service</Trans>}
			intro={
				<Trans comment="Opening paragraph of the terms of service">
					These are the terms for using this Reactive Resume deployment. They are written to be read rather than
					skipped. If something here is unclear, ask whoever runs this instance.
				</Trans>
			}
		>
			<LegalSection heading={<Trans comment="Section heading: description of the service">The service</Trans>}>
				<p>
					<Trans comment="Paragraph describing what the service is and is not">
						Reactive Resume is free and open-source software for writing and publishing a resume. You can read the
						source, and you can run it yourself. It is not a recruitment agency: it does not apply to jobs on your
						behalf, and nothing here gets you an interview.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: account responsibilities">Your account</Trans>}>
				<LegalList>
					<li>
						<Trans comment="Terms bullet: a working email address is required">
							Give an email address that works — verification and password resets go to it.
						</Trans>
					</li>
					<li>
						<Trans comment="Terms bullet: keeping credentials secret">
							Keep your password to yourself, and turn on two-factor authentication where this instance offers it.
						</Trans>
					</li>
					<li>
						<Trans comment="Terms bullet: responsibility for account activity">
							You are responsible for what happens under your account.
						</Trans>
					</li>
					<li>
						<Trans comment="Terms bullet: prohibited uses of the service">
							Do not use the service to publish other people's personal information without a reason to, to send spam,
							to attack this instance, or to break the law where you live.
						</Trans>
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection
				heading={<Trans comment="Section heading: ownership of user content">What you write stays yours</Trans>}
			>
				<p>
					<Trans comment="Paragraph on content ownership and the licence granted to the operator">
						You keep the rights to everything you write here. You give this deployment only the permission it needs to
						work: storing your content, turning it into a PDF, and showing it at the share links you publish yourself.
						No one here claims ownership of your resume, and nothing you write is licensed to anyone else.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: publishing a resume publicly">Publishing</Trans>}>
				<p>
					<Trans comment="Paragraph on how public resume links work">
						A resume is private until you publish it. Publishing creates a URL that anyone with the link can open, and
						an optional password protects it; unpublishing takes it down again. Do not put anything in a published
						resume that you would not want the open internet to read.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: no warranty">No warranty</Trans>}>
				<p>
					<Trans comment="Paragraph disclaiming warranties">
						The software is provided as it is, without warranty of any kind. It is maintained by volunteers, it can
						break, and it can lose work you have not exported. Keep your own copy of anything that matters.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: limitation of liability">Limitation of liability</Trans>}>
				<p>
					<Trans comment="Paragraph limiting liability, without overriding mandatory law">
						As far as the law allows, whoever runs this instance is not liable for indirect or consequential loss: a
						missed interview, a lost opportunity, or damage from relying on the service. Nothing here limits liability
						that cannot be limited by law.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: changes to the terms">Changes to these terms</Trans>}>
				<p>
					<Trans comment="Paragraph explaining how terms updates take effect">
						These terms can change. The version and the effective date above say which text applies, and a material
						change asks for your consent again when you sign up.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: governing law and dispute resolution">Disputes</Trans>}>
				<p>
					<Trans comment="Paragraph on governing law and severability">
						These terms follow the law of the place where this instance is operated, and disputes belong to the courts
						there. If one clause cannot be enforced, the rest still applies.
					</Trans>
				</p>
			</LegalSection>
		</LegalDocumentShell>
	);
}
