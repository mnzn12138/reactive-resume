import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import type { E2EAccount } from "./data";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";

// `/sign-up/email` rejects a payload that does not carry consent to the published
// documents, so the API fixture has to send it. `registerViaUi` goes through the
// register page, which collects the consent itself.
const legalConsent = { accepted: true, version: legalDocumentVersion } as const;

async function assertAuthResponse(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
	if (response.ok()) return;

	throw new Error(`Authentication request failed with ${response.status()}: ${await response.text()}`);
}

export async function registerViaUi(page: Page, account: E2EAccount) {
	await page.goto("/auth/register");
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(account.name);
	await page.getByLabel("Username").fill(account.username);
	await page.getByLabel("Email Address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	// `/sign-up/email` rejects a payload without consent and the form refuses to submit while the
	// box is unchecked, so the fixture has to accept before it can sign up. `FormControl` names the
	// checkbox with the sentence rendered next to it, hence the role + accessible-name lookup.
	await page.getByRole("checkbox", { name: /I have read and agree to the/ }).check();
	await page.getByRole("button", { name: "Sign up" }).click();
	await page.getByRole("button", { name: "Continue" }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function loginViaUi(page: Page, account: E2EAccount) {
	await page.goto("/auth/login");
	await page.getByLabel("Email Address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function logoutViaUi(page: Page, account: E2EAccount) {
	await page.getByText(account.email).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await page.goto("/auth/login");
}

async function registerViaApi(request: APIRequestContext, account: E2EAccount, baseURL: string) {
	const response = await request.post("/api/auth/sign-up/email", {
		headers: {
			origin: baseURL,
			referer: `${baseURL}/auth/register`,
		},
		data: {
			name: account.name,
			email: account.email,
			password: account.password,
			username: account.username,
			displayUsername: account.username,
			callbackURL: "/dashboard",
			legalConsent,
		},
	});

	await assertAuthResponse(response);
}

export async function createAuthenticatedContext(
	browser: Browser,
	request: APIRequestContext,
	account: E2EAccount,
	baseURL: string,
): Promise<BrowserContext> {
	await registerViaApi(request, account, baseURL);

	return browser.newContext({
		baseURL,
		storageState: await request.storageState(),
	});
}
