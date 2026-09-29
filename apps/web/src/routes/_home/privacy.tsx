import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { legalDocumentRoutes } from "@reactive-resume/schema/legal";
import { createLegalDocumentHead, LegalDocumentShell, LegalList, LegalSection } from "./-sections/legal-document";

export const Route = createFileRoute("/_home/privacy")({
	component: RouteComponent,
	head: () =>
		createLegalDocumentHead({
			path: legalDocumentRoutes.privacy,
			title: t({
				comment: "Browser and social-card title of the privacy policy page",
				message: "Privacy Policy - Reactive Resume",
			}),
			description: t({
				comment: "Search-result description of the privacy policy page",
				message:
					"What this Reactive Resume deployment stores about you, why it stores it, how long it keeps it, and what you can ask for.",
			}),
		}),
});

function RouteComponent() {
	return (
		<LegalDocumentShell
			title={<Trans comment="Heading of the privacy policy page">Privacy Policy</Trans>}
			intro={
				<Trans comment="Opening paragraph of the privacy policy">
					This instance of Reactive Resume is a self-hosted resume builder. This page says what the software stores,
					why, and what you can ask to have done with it. It describes this deployment's defaults: an administrator who
					switches on extra integrations changes the picture, and the sections below say where. If you need an answer
					specific to this instance, ask whoever runs it.
				</Trans>
			}
		>
			<LegalSection
				heading={<Trans comment="Section heading: who the privacy policy applies to">Who this applies to</Trans>}
			>
				<p>
					<Trans comment="Scope paragraph of the privacy policy">
						This policy covers the account you create here and everything you put in it: resumes, job applications, and
						uploaded files. It does not cover other Reactive Resume deployments. Each one keeps its own database, and an
						account does not carry between them.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: categories of data collected">What we collect</Trans>}>
				<LegalList>
					<li>
						<Trans comment="Privacy policy bullet: account details and password hashing">
							Account details: your email address, display name, and username. Your password is stored only as a hash,
							never in a form anyone can read back.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: user-authored resume and application content">
							What you write: the resumes, job applications, notes, and settings you create.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: uploaded files">
							Files you upload: profile pictures, attachments, and documents you import.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: sign-in records">
							Sign-in records: the times and approximate sources of successful and failed sign-ins, kept so that unusual
							access can be noticed.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: web server request logs">
							Server logs: request path, time, status, IP address, and user agent. Every web server writes these, and
							they are what makes an outage diagnosable.
						</Trans>
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: purposes of processing">How it is used</Trans>}>
				<p>
					<Trans comment="Paragraph listing the purposes data is used for">
						To run the service you asked for: storing your resumes, rendering them to PDF, publishing the links you
						choose to publish, sending the verification and password-reset emails you request, and keeping accounts
						secure. Your data is not sold, and it is not shared for advertising.
					</Trans>
				</p>
				<p>
					<Trans comment="Paragraph explaining the optional AI features and what they send">
						The AI features are optional, and off unless an administrator enables them. When they are on, a check sends
						what that check needs — the resume text you submit to it — to the model provider configured for this
						instance, and nothing else.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={
					<Trans comment="Section heading: storage location and retention period">
						Where it is stored, and for how long
					</Trans>
				}
			>
				<p>
					<Trans comment="Paragraph on storage location and retention period">
						Your data lives in this deployment's own database and file storage: on the machine that runs it, or in the
						object storage bucket its administrator configured. It is kept for as long as your account exists. Deleting
						a resume, or closing your account, removes it from the database. Backups taken by the operator may still
						hold a copy for a short while afterwards — ask that operator how long, because it is their choice and not
						something this page can promise.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={<Trans comment="Section heading: cookies and browser storage">Cookies and local storage</Trans>}
			>
				<p>
					<Trans comment="Paragraph on cookies and browser storage">
						Sign-in uses a session cookie, and it is strictly necessary: without it you would be signed out on every
						page. Your theme and language are remembered in your own browser. This site loads no advertising scripts and
						no third-party analytics.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={<Trans comment="Section heading: third-party services receiving data">Third-party services</Trans>}
			>
				<p>
					<Trans comment="Paragraph listing optional integrations that receive data">
						An administrator can connect services that necessarily receive some data: an SMTP provider for verification
						and password-reset emails, an S3-compatible bucket for uploads, Google, GitHub or LinkedIn for social
						sign-in, and a model provider for the optional AI features. Which of those are live depends on this
						deployment.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: the phone number used for sign-in">Phone number</Trans>}>
				<p>
					<Trans comment="Paragraph on what a phone number is stored as and what it is used for">
						If this instance has phone sign-in enabled and you choose to use it, your number is stored in international
						format: a leading plus sign, then the country code, then the rest of the number, as in +8613800138000.
						Alongside it sits a flag recording whether the number has been confirmed by a code you entered. It is used
						for signing you in and for getting you back into an account you cannot otherwise reach. It is not used to
						send you marketing, and it is not handed to anyone for that purpose.
					</Trans>
				</p>
				<p>
					<Trans comment="Paragraph on the placeholder email and on removing a phone number">
						This software requires a unique email address on every account, so one created by phone number alone is
						given a placeholder address derived from it. That address is not a mailbox and nothing is sent to it. You
						can change or remove the number from your account settings; removing it turns phone sign-in off for that
						account, so keep another way in if it is the only one you have.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={
					<Trans comment="Section heading: the providers that deliver verification text messages">
						Verification SMS providers
					</Trans>
				}
			>
				<p>
					<Trans comment="Paragraph on which SMS provider carries the code and why the number reaches it">
						If this instance has phone sign-in enabled, the one-time codes arrive as text messages sent by whichever
						provider the operator of this instance has configured and holds a contract with, which is one of Alibaba
						Cloud SMS or Tencent Cloud SMS. A code cannot be delivered without that provider receiving your number,
						because the number is the address the message goes to. Which of the two is in use is the operator's choice
						and not something this page can state on their behalf; ask them if you need to know.
					</Trans>
				</p>
				<p>
					<Trans comment="Paragraph on the hashed send log and its rate-limiting and audit purpose">
						Each message leaves a row in this deployment's own send log, and that row does not hold your number or your
						IP address in a readable form: it holds a keyed HMAC digest of each, from which the original cannot be
						recovered. The log is what makes the limits enforceable — a cooldown of sixty seconds between codes, ten
						messages per number per day, and twenty per IP address per hour — and what lets an operator trace abuse
						after the fact. It is not a record of anything you wrote, and it is not used for anything else.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={<Trans comment="Section heading: signing in through WeChat or Alipay">Third-party sign-in</Trans>}
			>
				<p>
					<Trans comment="Paragraph on the identifiers WeChat and Alipay return, and the absence of an email address">
						If this instance offers WeChat or Alipay sign-in and you use it, those services confirm who you are without
						handing over an email address. What they return is an identifier: an openid or a unionid from WeChat, a
						user_id from Alipay. It is stable for you within that service and means nothing outside it. That identifier
						is what gets stored and linked to your account. Because an email address is required on every account in
						this software, an account created this way is given a placeholder address generated for it. It is not a
						mailbox you can receive mail at, and nothing is sent to it.
					</Trans>
				</p>
				<p>
					<Trans comment="Paragraph on unlinking a third-party sign-in and keeping one way in">
						You can unlink WeChat or Alipay from your account settings at any time, and unlinking does not delete the
						account itself. At least one way of signing in has to stay — a password, or another linked service — because
						removing the last one would leave you unable to get back in. Which providers are offered at all is up to
						whoever runs this instance.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection
				heading={<Trans comment="Section heading: user rights over their data">What you can ask for</Trans>}
			>
				<LegalList>
					<li>
						<Trans comment="Privacy policy bullet: right of access and correction">
							See and correct your account details yourself, at any time, from settings.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: right to export data">
							Export your resumes as JSON or PDF and take them somewhere else.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: right to deletion">
							Delete individual resumes, or your whole account along with everything in it.
						</Trans>
					</li>
					<li>
						<Trans comment="Privacy policy bullet: contacting the operator for data requests">
							Ask whoever operates this instance for a copy of your data, or to erase it, if you cannot do it yourself.
						</Trans>
					</li>
				</LegalList>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: use by minors">Children</Trans>}>
				<p>
					<Trans comment="Paragraph on minimum age and guardian consent">
						This is a tool for people looking for work, and it is not directed at children. If you are under the age of
						digital consent where you live, use it with a parent or guardian.
					</Trans>
				</p>
			</LegalSection>

			<LegalSection heading={<Trans comment="Section heading: policy updates">Changes to this policy</Trans>}>
				<p>
					<Trans comment="Paragraph explaining how policy updates take effect">
						When this text changes, the version and the effective date above change with it, and signing up asks for
						consent again. The version published here is the one that applies to you.
					</Trans>
				</p>
			</LegalSection>
		</LegalDocumentShell>
	);
}
